import { getChain, DEFAULT_CHAIN_ID } from "./chains";

export const SINGLETON_ID = "primary";

const defaultChain = getChain(DEFAULT_CHAIN_ID);
if (!defaultChain) throw new Error(`Default chain ${DEFAULT_CHAIN_ID} is not configured`);

export const DEFAULT_CHAIN = defaultChain.chain;
export const DEFAULT_RPC_URL = defaultChain.rpcUrl;
