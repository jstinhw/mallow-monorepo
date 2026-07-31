import { http, createConfig, createConnector } from "wagmi";
import { arbitrum } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { type Address } from "viem";
import { unlockWallet, type UnlockedWallet } from "./wallet/wallet";
import type { Eip1193Provider } from "@/lib/wallet/eip6963";

const DEFAULT_CHAIN = arbitrum;

// Custom Wagmi Connector for Mallow local passkey wallet.
// It wraps the local decrypted private key session in Wagmi's state machine.
export function passkeyConnector() {
  let unlockedWallet: UnlockedWallet | null = null;
  type ConnectResult<withCapabilities extends boolean> = {
    accounts: withCapabilities extends true
      ? readonly { address: Address; capabilities: Record<string, unknown> }[]
      : readonly Address[];
    chainId: number;
  };

  return createConnector((_config) => ({
    id: "passkey",
    name: "Passkey Wallet",
    type: "passkey",

    async connect<withCapabilities extends boolean = false>(parameters?: {
      chainId?: number;
      isReconnecting?: boolean;
      withCapabilities?: boolean | withCapabilities;
    }): Promise<ConnectResult<withCapabilities>> {
      const unlocked = await unlockWallet();
      unlockedWallet = unlocked;

      const accounts = [unlocked.address];
      return {
        accounts: (parameters?.withCapabilities
          ? accounts.map((address) => ({ address, capabilities: {} }))
          : accounts) as unknown as ConnectResult<withCapabilities>["accounts"],
        chainId: parameters?.chainId ?? DEFAULT_CHAIN.id,
      };
    },

    async disconnect() {
      unlockedWallet = null;
    },

    async getAccounts() {
      return unlockedWallet ? [unlockedWallet.address] : [];
    },

    async getChainId() {
      return DEFAULT_CHAIN.id;
    },

    async getProvider() {
      return {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (!unlockedWallet || unlockedWallet.kind !== "passkey") {
            throw new Error("Passkey wallet not unlocked");
          }
          if (method === "eth_accounts") {
            return [unlockedWallet.address];
          }
          if (method === "personal_sign") {
            const message = params?.[0];
            if (typeof message !== "string") {
              throw new Error("personal_sign requires a string message");
            }
            return unlockedWallet.account.signMessage({ message });
          }
          if (unlockedWallet.client.transport.request) {
            return unlockedWallet.client.transport.request({ method, params });
          }
          throw new Error(`Unsupported provider request method: ${method}`);
        },
      } as Eip1193Provider;
    },

    async isAuthorized() {
      // Return false on reload to prevent auto-triggering biometric prompt on page load
      return false;
    },

    getUnlockedWallet() {
      return unlockedWallet;
    },

    onAccountsChanged(_accounts) {},
    onChainChanged(_chain) {},
    onDisconnect(_error) {},
  }));
}

export const wagmiConfig = createConfig({
  chains: [DEFAULT_CHAIN],
  connectors: [injected(), passkeyConnector()],
  transports: {
    [DEFAULT_CHAIN.id]: http(),
  },
});
