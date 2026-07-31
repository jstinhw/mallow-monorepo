import type { Hex } from "viem";
import type { Finding } from "../../protocol";
import { makeFinding } from "../risk";

const MAX_UINT256 = (1n << 256n) - 1n;

// Only selectors for ratified EIP standards belong here.
// AMM/DeFi-specific functions (sync, skim, burn variants) are NOT listed because
// an attacker can reimplement the same logic under a different name. Those patterns
// are detected via contract source code analysis (get_contract_info) + simulation
// behavior (ERC-20 Transfer-to-address(0) events per EIP-20).
const SELECTORS = {
  approve: "0x095ea7b3", // EIP-20
  setApprovalForAll: "0xa22cb465", // EIP-721 / EIP-1155
  transfer: "0xa9059cbb", // EIP-20
  transferFrom: "0x23b872dd", // EIP-20
  permit: "0xd505accf", // EIP-2612
} as const;

function readWord(data: string, index: number): bigint {
  const start = 10 + index * 64;
  return BigInt("0x" + data.slice(start, start + 64));
}

export function selectorFindings(args: {
  selector: Hex;
  signature?: string;
  data: Hex;
}): Finding[] {
  const out: Finding[] = [];
  if (args.selector === SELECTORS.approve) {
    const value = readWord(args.data, 1);
    if (value === MAX_UINT256) {
      out.push(
        makeFinding({
          id: "infinite-approval",
          severity: "high",
          title: "Infinite ERC-20 approval",
          detail: "Spender will be allowed to move the token's full balance, indefinitely.",
        }),
      );
    } else {
      out.push(
        makeFinding({
          id: "erc20-approve",
          severity: "low",
          title: "Bounded ERC-20 approval",
          detail: `Spender allowance set to ${value.toString()}.`,
        }),
      );
    }
  }
  if (args.selector === SELECTORS.setApprovalForAll) {
    const flag = readWord(args.data, 1);
    if (flag === 1n) {
      out.push(
        makeFinding({
          id: "nft-blanket-approval",
          severity: "high",
          title: "NFT collection-wide approval",
          detail: "Operator will be allowed to move every NFT you own in this collection.",
        }),
      );
    }
  }
  if (args.selector === SELECTORS.transfer) {
    out.push(
      makeFinding({
        id: "erc20-transfer",
        severity: "info",
        title: "ERC-20 transfer",
        detail: "A direct token transfer from your wallet.",
      }),
    );
  }
  if (args.selector === SELECTORS.transferFrom) {
    out.push(
      makeFinding({
        id: "erc20-transfer-from",
        severity: "info",
        title: "ERC-20 transferFrom",
        detail: "Pulls tokens via a prior approval.",
      }),
    );
  }
  if (args.selector === SELECTORS.permit) {
    out.push(
      makeFinding({
        id: "erc20-permit",
        severity: "low",
        title: "EIP-2612 permit",
        detail: "Off-chain signed approval. Verify the spender and amount.",
      }),
    );
  }
  return out;
}
