import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createWalletClient,
  custom,
  getTypesForEIP712Domain,
  http,
  isAddress,
  isAddressEqual,
  numberToHex,
  serializeTypedData,
  type Address,
  type Hex,
  type WalletClient,
  toHex,
} from "viem";
import { decryptKey, deriveKey, encryptKey, randomBytes } from "./crypto";
import {
  activeWalletKind,
  loadWallet,
  saveActiveInjectedWallet,
  saveWallet,
  type StoredInjectedWalletConnection,
  type StoredPasskeyWallet,
  type StoredWallet,
} from "./storage";
import { findInjectedWallet, type Eip1193Provider } from "./eip6963";
import { getPrfFromPasskey, prfSupported, registerPasskey } from "./passkey";
import { DEFAULT_CHAIN_ID, getChain } from "@/lib/constants/chains";
import { DEFAULT_CHAIN, DEFAULT_RPC_URL } from "@/lib/constants/wallet";

type LocalAccount = ReturnType<typeof privateKeyToAccount>;
type WalletAccount = Pick<LocalAccount, "address" | "signMessage" | "signTypedData">;

type PasskeyUnlockedWallet = {
  kind: "passkey";
  address: Address;
  account: LocalAccount;
  client: WalletClient;
};

type InjectedUnlockedWallet = {
  kind: "injected";
  address: Address;
  account: WalletAccount;
  client: WalletClient;
  provider: Eip1193Provider;
};

export type UnlockedWallet = PasskeyUnlockedWallet | InjectedUnlockedWallet;

const PASSKEY_SESSION_KEY = "mallow:passkey-session:v1";

type PasskeySession = {
  walletId: string;
  address: Address;
  privateKey: Hex;
};

async function decryptStoredPrivateKey(stored: StoredPasskeyWallet): Promise<Uint8Array> {
  const prf = await getPrfFromPasskey(stored.credentialId, stored.prfSalt);
  const key = await deriveKey(prf, stored.hkdfSalt);
  return decryptKey(key, stored.ciphertext, stored.iv);
}

export async function createWallet(): Promise<{ address: Address }> {
  if (!prfSupported()) throw new Error("WebAuthn/PRF not supported in this browser.");
  const pk = randomBytes(32);
  const account = privateKeyToAccount(toHex(pk));
  const prfSalt = randomBytes(32);
  const hkdfSalt = randomBytes(32);
  const { credentialId, prfOutput } = await registerPasskey(prfSalt);
  const key = await deriveKey(prfOutput, hkdfSalt);
  const { ciphertext, iv } = await encryptKey(key, pk);
  const stored: StoredWallet = {
    kind: "passkey",
    id: crypto.randomUUID(),
    address: account.address,
    credentialId,
    ciphertext,
    iv,
    hkdfSalt,
    prfSalt,
    createdAt: Date.now(),
  };
  await saveWallet(stored);
  pk.fill(0);
  // generatePrivateKey is imported only to ensure it tree-shakes; we use randomBytes directly.
  void generatePrivateKey;
  return { address: account.address };
}

export async function unlockWallet(): Promise<UnlockedWallet> {
  const stored = await loadWallet();
  if (!stored) throw new Error("No wallet found.");
  if (stored.kind === "injected") {
    const provider = stored.rdns ? await findInjectedWallet(stored.rdns) : null;
    return connectInjectedWallet({
      provider: provider ?? undefined,
      rdns: stored.rdns,
      preferredAddress: stored.address,
    });
  }

  const pk = await decryptStoredPrivateKey(stored);
  try {
    const privateKey = toHex(pk);
    const wallet = buildPasskeyWallet(privateKey);
    savePasskeySession(stored, privateKey);
    return wallet;
  } finally {
    pk.fill(0);
  }
}

export async function restorePasskeySessionWallet(): Promise<UnlockedWallet | null> {
  const stored = await loadWallet();
  if (!stored || stored.kind === "injected") return null;

  const session = loadPasskeySession();
  if (!session) return null;
  if (session.walletId !== stored.id || !isAddressEqual(session.address, stored.address)) {
    clearPasskeySession();
    return null;
  }

  const wallet = buildPasskeyWallet(session.privateKey);
  if (!isAddressEqual(wallet.address, stored.address)) {
    clearPasskeySession();
    return null;
  }
  return wallet;
}

export async function restoreConnectedWallet(): Promise<UnlockedWallet | null> {
  const stored = await loadWallet();
  if (!stored || activeWalletKind(stored) !== "injected") return null;
  const connection =
    stored.kind === "injected"
      ? {
          kind: "injected" as const,
          address: stored.address,
          rdns: stored.rdns,
          connectedAt: stored.createdAt,
        }
      : stored.activeInjectedWallet;
  if (!connection) return null;

  const provider = connection.rdns ? await findInjectedWallet(connection.rdns) : null;
  return restoreInjectedWallet({
    provider: provider ?? undefined,
    rdns: connection.rdns,
    preferredAddress: connection.address,
  });
}

export async function connectInjectedWallet(
  opts: {
    provider?: Eip1193Provider;
    rdns?: string;
    preferredAddress?: Address;
  } = {},
): Promise<UnlockedWallet> {
  const provider = opts.provider ?? injectedProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as unknown[];
  const addresses = accounts.filter(
    (account): account is Address => typeof account === "string" && isAddress(account),
  );
  if (addresses.length === 0) throw new Error("No wallet account returned by browser wallet.");

  const address =
    opts.preferredAddress &&
    addresses.some((account) => isAddressEqual(account, opts.preferredAddress!))
      ? opts.preferredAddress
      : addresses[0];
  const account = injectedAccount(provider, address);
  const client = createWalletClient({
    account: address,
    chain: DEFAULT_CHAIN,
    transport: custom(provider),
  });
  await persistInjectedConnection({ address, rdns: opts.rdns });
  return { kind: "injected", address, account, client, provider };
}

async function restoreInjectedWallet(opts: {
  provider?: Eip1193Provider;
  rdns?: string;
  preferredAddress: Address;
}): Promise<UnlockedWallet | null> {
  const provider = opts.provider ?? injectedProviderOrNull();
  if (!provider) return null;
  const accounts = (await provider
    .request({ method: "eth_accounts" })
    .catch(() => [])) as unknown[];
  const address = accounts.find(
    (account): account is Address =>
      typeof account === "string" &&
      isAddress(account) &&
      isAddressEqual(account, opts.preferredAddress),
  );
  if (!address) return null;

  const account = injectedAccount(provider, address);
  const client = createWalletClient({
    account: address,
    chain: DEFAULT_CHAIN,
    transport: custom(provider),
  });
  await persistInjectedConnection({ address, rdns: opts.rdns });
  return { kind: "injected", address, account, client, provider };
}

async function persistInjectedConnection(opts: { address: Address; rdns?: string }): Promise<void> {
  const connection: StoredInjectedWalletConnection = {
    kind: "injected",
    address: opts.address,
    rdns: opts.rdns,
    connectedAt: Date.now(),
  };
  await saveActiveInjectedWallet(connection);
}

export async function sendWalletTransaction(
  wallet: UnlockedWallet,
  tx: { chainId: number; to: Address; value: bigint; data: Hex },
): Promise<Hex> {
  const chainConfig = getChain(tx.chainId);
  if (!chainConfig?.rpcUrl) throw new Error(`chain ${tx.chainId} not configured`);

  if (wallet.kind === "passkey") {
    const client = createWalletClient({
      account: wallet.account,
      chain: chainConfig.chain,
      transport: http(chainConfig.rpcUrl),
    });
    return client.sendTransaction({
      account: wallet.account,
      chain: chainConfig.chain,
      to: tx.to,
      value: tx.value,
      data: tx.data,
    });
  }

  await switchInjectedChain(wallet.provider, tx.chainId);
  return wallet.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: wallet.address,
        to: tx.to,
        value: numberToHex(tx.value),
        data: tx.data,
      },
    ],
  }) as Promise<Hex>;
}

export async function exportPrivateKey(): Promise<Hex> {
  const stored = await loadWallet();
  if (!stored) throw new Error("No wallet found.");
  if (stored.kind === "injected") {
    throw new Error("Private key export is not available for a connected browser wallet.");
  }

  const pk = await decryptStoredPrivateKey(stored);
  try {
    const privateKey = toHex(pk);
    const account = privateKeyToAccount(privateKey);
    if (!isAddressEqual(account.address, stored.address)) {
      throw new Error("Decrypted key does not match the stored wallet.");
    }
    return privateKey;
  } finally {
    pk.fill(0);
  }
}

export function clearPasskeySession(): void {
  getSessionStorage()?.removeItem(PASSKEY_SESSION_KEY);
}

function savePasskeySession(stored: StoredPasskeyWallet, privateKey: Hex): void {
  const session: PasskeySession = {
    walletId: stored.id,
    address: stored.address,
    privateKey,
  };
  getSessionStorage()?.setItem(PASSKEY_SESSION_KEY, JSON.stringify(session));
}

function loadPasskeySession(): PasskeySession | null {
  const raw = getSessionStorage()?.getItem(PASSKEY_SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PasskeySession>;
    if (
      typeof parsed.walletId !== "string" ||
      typeof parsed.address !== "string" ||
      !isAddress(parsed.address) ||
      typeof parsed.privateKey !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(parsed.privateKey)
    ) {
      clearPasskeySession();
      return null;
    }
    return {
      walletId: parsed.walletId,
      address: parsed.address,
      privateKey: parsed.privateKey as Hex,
    };
  } catch {
    clearPasskeySession();
    return null;
  }
}

function buildPasskeyWallet(privateKey: Hex): UnlockedWallet {
  const account = privateKeyToAccount(privateKey);
  if (!DEFAULT_RPC_URL) throw new Error(`chain ${DEFAULT_CHAIN_ID} not configured`);
  const client = createWalletClient({
    account,
    chain: DEFAULT_CHAIN,
    transport: http(DEFAULT_RPC_URL),
  });
  return { kind: "passkey", address: account.address, account, client };
}

function getSessionStorage(): Storage | null {
  if (typeof globalThis.sessionStorage === "undefined") return null;
  return globalThis.sessionStorage;
}

function injectedProvider(): Eip1193Provider {
  const provider = injectedProviderOrNull();
  if (!provider) throw new Error("No browser wallet found. Install or enable a wallet extension.");
  return provider;
}

function injectedProviderOrNull(): Eip1193Provider | null {
  return (globalThis as typeof globalThis & { ethereum?: Eip1193Provider }).ethereum ?? null;
}

function injectedAccount(provider: Eip1193Provider, address: Address): WalletAccount {
  const assertSelectedAccount = async () => {
    const accounts = (await provider
      .request({ method: "eth_accounts" })
      .catch(() => [])) as unknown[];
    const selected = accounts.find(
      (account): account is Address => typeof account === "string" && isAddress(account),
    );
    if (!selected || !isAddressEqual(selected, address)) {
      throw new Error(
        `Browser wallet selected account is ${selected ?? "unknown"}, expected ${address}. Switch accounts in MetaMask and try again.`,
      );
    }
  };

  return {
    address,
    signMessage: async ({ message }) => {
      await assertSelectedAccount();
      const raw = typeof message === "string" ? toHex(message) : message.raw;
      return provider.request({
        method: "personal_sign",
        params: [raw, address],
      }) as Promise<Hex>;
    },
    signTypedData: async (typedData) => {
      await assertSelectedAccount();
      return provider.request({
        method: "eth_signTypedData_v4",
        params: [address, serializeInjectedTypedData(typedData)],
      }) as Promise<Hex>;
    },
  };
}

async function switchInjectedChain(provider: Eip1193Provider, chainId: number): Promise<void> {
  const chainHex = numberToHex(chainId);
  const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (typeof current === "string" && current.toLowerCase() === chainHex.toLowerCase()) return;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err &&
      "code" in err &&
      (err as { code: unknown }).code === 4902
    ) {
      await addInjectedChain(provider, chainId);
      return;
    }
    throw err;
  }
}

async function addInjectedChain(provider: Eip1193Provider, chainId: number): Promise<void> {
  const chainConfig = getChain(chainId);
  if (!chainConfig?.rpcUrl) throw new Error(`chain ${chainId} not configured`);
  const chain = chainConfig.chain;
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: numberToHex(chainId),
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [chainConfig.rpcUrl],
        blockExplorerUrls: chain.blockExplorers?.default.url
          ? [chain.blockExplorers.default.url]
          : [],
      },
    ],
  });
}

// Serialize EIP-712 typed data the way viem's own wallet client does before
// handing it to `eth_signTypedData_v4`: inject the `EIP712Domain` type entry
// (derived from the domain) so the wallet hashes the full document. The service
// hands us typed data whose `types` only declares the message struct (e.g.
// `Enable`); MetaMask needs `EIP712Domain` to build the domain separator. Local
// (passkey) accounts add it internally when they hash, which is why omitting it
// here only broke connected wallets — their signatures recovered to the wrong
// address. serializeTypedData also stringifies bigints, so callers don't have to.
function serializeInjectedTypedData(typedData: unknown): string {
  const {
    domain = {},
    message,
    primaryType,
    types,
  } = typedData as {
    domain?: Parameters<typeof getTypesForEIP712Domain>[0]["domain"];
    message: Record<string, unknown>;
    primaryType: string;
    types: Record<string, unknown>;
  };
  return serializeTypedData({
    domain,
    message,
    primaryType,
    types: {
      EIP712Domain: getTypesForEIP712Domain({ domain }),
      ...types,
    },
  } as Parameters<typeof serializeTypedData>[0]);
}
