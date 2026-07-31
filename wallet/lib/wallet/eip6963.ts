// EIP-6963 multi-injected-provider discovery. Lets us enumerate every browser
// wallet the user has installed (MetaMask, Rainbow, Coinbase, …) by name + icon
// instead of guessing at the single `window.ethereum` slot. Each wallet
// announces itself in response to our request event; we key them by `rdns` so a
// wallet that announces twice collapses to one entry.

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type EIP6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type EIP6963ProviderDetail = {
  info: EIP6963ProviderInfo;
  provider: Eip1193Provider;
};

const ANNOUNCE = "eip6963:announceProvider";
const REQUEST = "eip6963:requestProvider";

function readDetail(event: Event): EIP6963ProviderDetail | null {
  const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
  return detail?.info?.rdns && detail.provider ? detail : null;
}

// Subscribes to wallet announcements. Calls `onChange` with the de-duplicated
// list each time a new wallet appears, and returns an unsubscribe function.
export function subscribeToInjectedWallets(
  onChange: (wallets: EIP6963ProviderDetail[]) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const byRdns = new Map<string, EIP6963ProviderDetail>();
  const handler = (event: Event) => {
    const detail = readDetail(event);
    if (!detail) return;
    if (byRdns.has(detail.info.rdns)) return;
    byRdns.set(detail.info.rdns, detail);
    onChange([...byRdns.values()]);
  };

  window.addEventListener(ANNOUNCE, handler);
  window.dispatchEvent(new Event(REQUEST));
  return () => window.removeEventListener(ANNOUNCE, handler);
}

// Resolves the provider for a specific wallet by its `rdns`, used when
// reconnecting a previously chosen wallet. Resolves to null if that wallet is
// no longer announced within the timeout.
export function findInjectedWallet(rdns: string, timeoutMs = 400): Promise<Eip1193Provider | null> {
  if (typeof window === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const handler = (event: Event) => {
      const detail = readDetail(event);
      if (!detail || detail.info.rdns !== rdns) return;
      cleanup();
      resolve(detail.provider);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener(ANNOUNCE, handler);
    };

    window.addEventListener(ANNOUNCE, handler);
    window.dispatchEvent(new Event(REQUEST));
  });
}
