import type { Address } from "viem";
import type { ContractInfo, Finding, RiskLevel, SimulationResult, TraceCall } from "../../protocol";
import { makeFinding } from "../risk";

export type ContractLookup = (addr: Address) => ContractInfo | null;

const ETH = 10n ** 18n;
function valueSeverity(absWei: bigint): RiskLevel {
  if (absWei < ETH / 100n) return "info";
  if (absWei < ETH / 10n) return "low";
  if (absWei < ETH) return "medium";
  return "high";
}

function* walk(t: TraceCall): Generator<TraceCall> {
  yield t;
  for (const c of t.calls ?? []) yield* walk(c);
}

// A verified proxy delegating to its own declared implementation is the standard
// EIP-1967 pattern, not injected code. The caller (node.from) is the proxy; the
// target (node.to) is the implementation it points at.
function isProxyDelegation(node: TraceCall, contractAt: ContractLookup): boolean {
  const caller = contractAt(node.from);
  return Boolean(
    caller &&
    caller.verified &&
    caller.isProxy &&
    caller.implementation &&
    caller.implementation.toLowerCase() === node.to.toLowerCase(),
  );
}

export function simulationFindings(
  sim: SimulationResult,
  from: Address,
  to: Address,
  contractAt: ContractLookup,
  sentValue?: bigint,
): Finding[] {
  const out: Finding[] = [];

  if (!sim.success) {
    out.push(
      makeFinding({
        id: "simulation-reverts",
        severity: "high",
        title: "Transaction reverts in simulation",
        detail:
          sim.revertReason ??
          "The simulated tx failed; signing it will burn gas with no state change.",
      }),
    );
  }

  let sawSelfdestruct = false;
  let sawDelegatecallToUnverified = false;
  let sawValueToUnverified = false;
  for (const node of walk(sim.trace)) {
    if (node.type === "SELFDESTRUCT") sawSelfdestruct = true;
    if (node.type === "DELEGATECALL") {
      const target = contractAt(node.to);
      if ((!target || !target.verified) && !isProxyDelegation(node, contractAt)) {
        sawDelegatecallToUnverified = true;
      }
    }
    if (node.value && node.value > 0n) {
      const target = contractAt(node.to);
      if (target && !target.verified) sawValueToUnverified = true;
    }
  }
  if (sawSelfdestruct) {
    out.push(
      makeFinding({
        id: "selfdestruct-in-trace",
        severity: "critical",
        title: "Contract selfdestructs during execution",
        detail:
          "A contract in the call tree triggers SELFDESTRUCT — funds may be permanently destroyed.",
      }),
    );
  }
  if (sawDelegatecallToUnverified) {
    out.push(
      makeFinding({
        id: "delegatecall-to-unverified",
        severity: "critical",
        title: "DELEGATECALL into unverified code",
        detail:
          "Code from an unverified contract will execute in this contract's context. Treat as code injection.",
      }),
    );
  }
  if (sawValueToUnverified) {
    out.push(
      makeFinding({
        id: "value-to-unverified",
        severity: "medium",
        title: "ETH flows into an unverified contract",
        detail: "Value lands at a contract Etherscan has no source for.",
      }),
    );
  }

  const fromDelta = sim.balanceChanges.find((b) => b.address.toLowerCase() === from.toLowerCase());
  if (fromDelta && fromDelta.deltaWei < 0n) {
    const abs = -fromDelta.deltaWei;
    out.push(
      makeFinding({
        id: "value-leaves-wallet",
        severity: valueSeverity(abs),
        title: `${abs.toString()} wei leaves your wallet`,
        detail: "Net ETH outflow from your address per simulation.",
      }),
    );
  }

  // ERC-20 drainer pattern: user sends tokens via a contract call but receives none back.
  // Excludes direct token transfers (where to === the token contract itself) since those
  // are intentional sends. Triggers on DeFi calls — routers, vaults, unknown contracts —
  // where the expectation is to receive something in return.
  if (sim.success && sim.erc20Transfers.length > 0) {
    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();
    const sentTokens = new Set<string>(
      sim.erc20Transfers
        .filter((t) => t.from.toLowerCase() === fromLower)
        .map((t) => t.token.toLowerCase()),
    );
    const receivedTokens = new Set<string>(
      sim.erc20Transfers
        .filter((t) => t.to.toLowerCase() === fromLower)
        .map((t) => t.token.toLowerCase()),
    );
    if (sentTokens.size > 0 && receivedTokens.size === 0) {
      // Only flag when the called contract is not the token itself (i.e. not a plain transfer)
      const isDirectTokenTransfer = [...sentTokens].every((t) => t === toLower);
      if (!isDirectTokenTransfer) {
        out.push(
          makeFinding({
            id: "erc20-drainer-pattern",
            severity: "high",
            title: "Tokens leave your wallet with nothing returned",
            detail:
              "The simulation shows your ERC-20 tokens transferred out through this contract call but no tokens arriving back at your address. For a swap or DeFi interaction this is a drainer signal — verify the recipient in the calldata matches your own address.",
          }),
        );
      }
    }
  }

  // Native value drainer: user sends ETH/BNB with the call, ERC-20 tokens move, but
  // none of those tokens arrive at the sender's address. This covers ETH→token swap
  // calls (e.g. swapExactETHForTokens) where the `to` output parameter is set to a
  // contract or attacker address rather than the user, causing the purchased tokens to
  // be stolen without the user receiving anything.
  if (sim.success && sentValue && sentValue > 0n && sim.erc20Transfers.length > 0) {
    const fromLower = from.toLowerCase();
    const receivedAny = sim.erc20Transfers.some((t) => t.to.toLowerCase() === fromLower);
    if (!receivedAny) {
      out.push(
        makeFinding({
          id: "native-drainer-pattern",
          severity: "high",
          title: "ETH/BNB sent but no tokens received at your address",
          detail:
            "You sent native currency with this call and ERC-20 transfers happened, but none of those tokens arrived at your address. For a swap this means the purchased tokens went to another address — verify the recipient parameter in the calldata is your own wallet.",
        }),
      );
    }
  }

  // Large burn from AMM reserves: many ERC-20 Transfer events to address(0) suggest
  // a token contract is burning its own AMM pool reserves — this can crash the pool price.
  const ZERO = "0x0000000000000000000000000000000000000000";
  const burnTransfers = sim.erc20Transfers.filter((t) => t.to.toLowerCase() === ZERO);
  if (burnTransfers.length >= 2) {
    out.push(
      makeFinding({
        id: "large-reserve-burn",
        severity: "high",
        title: "Multiple ERC-20 burn events detected",
        detail:
          "The simulation shows tokens being burned to address(0) in multiple transfers. If these originate from an AMM pair, the burn crashes the pool's token reserve and can enable price-manipulation drains.",
      }),
    );
  }

  return out;
}
