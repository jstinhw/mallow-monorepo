export const PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";

export const METADATA = {
  name: "mallow",
  description: "An agent-native wallet that thinks with you.",
  url: typeof window !== "undefined" ? window.location.origin : "https://mallow.app",
  icons: ["https://mallow.app/icon.png"],
};

export const WC_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
] as const;

export const WC_EVENTS = ["chainChanged", "accountsChanged"] as const;

export const SIGN_METHODS = new Set(["personal_sign", "eth_signTypedData", "eth_signTypedData_v4"]);
