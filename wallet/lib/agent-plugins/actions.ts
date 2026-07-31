// Executes an AgentRequest's actions with the user's wallet and returns one
// result per action, in order, for POSTing back to the agent service. The
// wallet only signs or broadcasts — it never interprets what a signature
// authorizes (e.g. a ZeroDev session-account approval), so agent-service
// internals stay out of the app. A "sig" action yields a signature; a "tx"
// action yields a broadcast txnHash.

import { isAddressEqual, recoverTypedDataAddress, type Hex } from "viem";
import type {
  AgentInstallTxnResult,
  AgentRequest,
  AgentRequestSigAction,
  AgentRequestTxAction,
} from "@mallow/agents-protocol";
import { sendWalletTransaction, type UnlockedWallet } from "@/lib/wallet/wallet";

async function signSigAction(action: AgentRequestSigAction, wallet: UnlockedWallet): Promise<Hex> {
  if (!isAddressEqual(wallet.account.address, action.signer)) {
    throw new Error(
      `Agent action must be signed by ${action.signer}, but the active wallet is ${wallet.account.address}. Switch to the requested wallet and try again.`,
    );
  }
  if (action.payload.type === "typedData") {
    // The service hands us a ready-to-sign EIP-712 envelope; viem's typing is
    // stricter than the wire shape, so we sign it verbatim.
    const signature = (await wallet.account.signTypedData(
      action.payload.typedData as never,
    )) as Hex;
    const typedData = action.payload.typedData;
    const recovered = await recoverTypedDataAddress({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature,
    } as never);
    if (!isAddressEqual(recovered, action.signer)) {
      throw new Error(
        `Agent action signature recovered ${recovered}, expected ${action.signer}. Make sure MetaMask is signing with the requested wallet.`,
      );
    }
    return signature;
  }
  return wallet.account.signMessage({ message: { raw: action.payload.message } });
}

async function sendTxAction(action: AgentRequestTxAction, wallet: UnlockedWallet): Promise<Hex> {
  return sendWalletTransaction(wallet, {
    chainId: action.chainId,
    to: action.to,
    value: BigInt(action.value),
    data: action.data,
  });
}

export async function executeAgentRequestActions(opts: {
  request: AgentRequest;
  wallet: UnlockedWallet;
}): Promise<AgentInstallTxnResult[]> {
  // Sequential on purpose: multiple tx actions share the wallet's EOA nonce, so
  // they must be broadcast one at a time and kept in request order.
  const results: AgentInstallTxnResult[] = [];
  for (const action of opts.request.actions) {
    if (action.kind === "sig") {
      const data = await signSigAction(action, opts.wallet);
      results.push({ chainId: action.chainId, kind: "sig", data });
    } else {
      const data = await sendTxAction(action, opts.wallet);
      results.push({ chainId: action.chainId, kind: "tx", data });
    }
  }
  return results;
}
