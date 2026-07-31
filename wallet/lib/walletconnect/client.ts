import { Core } from "@walletconnect/core";
import { WalletKit, type IWalletKit } from "@reown/walletkit";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import type { Address } from "viem";
import { buildSupportedNamespaces } from "./requests";
import { METADATA, PROJECT_ID } from "@/lib/constants/walletconnect";

export class WalletConnectNotConfigured extends Error {
  constructor() {
    super("WalletConnect project id is not configured (NEXT_PUBLIC_REOWN_PROJECT_ID).");
  }
}

export function isWalletConnectConfigured(): boolean {
  return PROJECT_ID.length > 0;
}

let kitPromise: Promise<IWalletKit> | null = null;

export function getWalletKit(): Promise<IWalletKit> {
  if (!isWalletConnectConfigured()) return Promise.reject(new WalletConnectNotConfigured());
  if (!kitPromise) {
    kitPromise = WalletKit.init({ core: new Core({ projectId: PROJECT_ID }), metadata: METADATA });
  }
  return kitPromise;
}

export async function pair(uri: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.pair({ uri });
}

export async function approveSession(args: {
  id: number;
  proposalParams: Parameters<typeof buildApprovedNamespaces>[0]["proposal"];
  eoa: Address;
}): Promise<void> {
  const kit = await getWalletKit();
  const namespaces = buildApprovedNamespaces({
    proposal: args.proposalParams,
    supportedNamespaces: buildSupportedNamespaces(args.eoa, args.proposalParams),
  });
  await kit.approveSession({ id: args.id, namespaces });
}

export async function rejectSession(id: number): Promise<void> {
  const kit = await getWalletKit();
  await kit.rejectSession({ id, reason: getSdkError("USER_REJECTED") });
}

// Outcome of trying to answer a session request. `delivered: false` means the
// request no longer existed on the relay (it expired and was deleted before we
// responded) — there is nothing to deliver to, so callers should treat it as a
// non-fatal "the dApp won't hear back" rather than an error.
export type RespondOutcome = { delivered: boolean };

// WalletConnect's relay expires pending requests after their TTL and drops them
// into a "recentlyDeleted" map; responding then throws MISSING_OR_INVALID
// ("Record was recently deleted - request: <id>"). That is expected when a slow
// review outlasts the request, so we report it instead of throwing an unhandled
// rejection. Any other failure is a real bug and is rethrown.
function isStaleRequestError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /recently deleted|no matching key|missing or invalid/i.test(message);
}

export async function respondResult(
  topic: string,
  id: number,
  result: unknown,
): Promise<RespondOutcome> {
  const kit = await getWalletKit();
  try {
    await kit.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", result } });
    return { delivered: true };
  } catch (err) {
    if (isStaleRequestError(err)) return { delivered: false };
    throw err;
  }
}

export async function respondError(
  topic: string,
  id: number,
  message = "User rejected.",
): Promise<RespondOutcome> {
  const kit = await getWalletKit();
  try {
    await kit.respondSessionRequest({
      topic,
      response: { id, jsonrpc: "2.0", error: { code: 4001, message } },
    });
    return { delivered: true };
  } catch (err) {
    if (isStaleRequestError(err)) return { delivered: false };
    throw err;
  }
}

export async function disconnectSession(topic: string): Promise<void> {
  const kit = await getWalletKit();
  await kit.disconnectSession({ topic, reason: getSdkError("USER_DISCONNECTED") });
}
