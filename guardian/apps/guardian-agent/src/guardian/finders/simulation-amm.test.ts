import { describe, it, expect } from "vitest";
import { simulationFindings, type ContractLookup } from "./simulation";
import type { Address } from "viem";
import type { SimulationResult } from "../../protocol";

const ATTACKER = "0x047547A4fa4a67C1032d249B49EC1a79c0460BAD" as Address;
const ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E" as Address;
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address;
const BY = "0x6f50cffEcd4e00EcF7E442774C08c089450B62Ca" as Address;
const PAIR = "0x1F358e18e0DB68FF33C2319C8DaD328eDF9B7059" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

const noLookup: ContractLookup = () => null;

function baseSim(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    success: true,
    gasUsed: 120000n,
    trace: { type: "CALL", from: ATTACKER, to: ROUTER },
    balanceChanges: [],
    erc20Transfers: [],
    erc721Transfers: [],
    storageDiffs: [],
    ...overrides,
  };
}

describe("ERC-20 drainer detection (corner buy → tokens go to ROUTER not user)", () => {
  it("flags HIGH when user sends tokens but nothing returns to user (swap to router)", () => {
    const sim = baseSim({
      erc20Transfers: [
        { token: WBNB, from: ATTACKER, to: ROUTER, amount: 7_098_440_043n * 10n ** 9n },
        { token: BY, from: PAIR, to: ROUTER, amount: 1_000_000n * 10n ** 18n },
      ],
    });
    const findings = simulationFindings(sim, ATTACKER, ROUTER, noLookup);
    const drainer = findings.find((f) => f.id === "erc20-drainer-pattern");
    expect(drainer).toBeDefined();
    expect(drainer?.severity).toBe("high");
  });

  it("does NOT flag drainer on a normal swap where tokens return to user", () => {
    const sim = baseSim({
      erc20Transfers: [
        { token: WBNB, from: ATTACKER, to: ROUTER, amount: 10n ** 18n },
        { token: BY, from: PAIR, to: ATTACKER, amount: 5_000n * 10n ** 18n },
      ],
    });
    const findings = simulationFindings(sim, ATTACKER, ROUTER, noLookup);
    const drainer = findings.find((f) => f.id === "erc20-drainer-pattern");
    expect(drainer).toBeUndefined();
  });

  it("does NOT flag drainer on a plain transfer() to another address", () => {
    const RECIPIENT = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Address;
    // to = WBNB token contract (direct transfer), token sent = WBNB
    const sim = baseSim({
      trace: { type: "CALL", from: ATTACKER, to: WBNB },
      erc20Transfers: [{ token: WBNB, from: ATTACKER, to: RECIPIENT, amount: 10n ** 18n }],
    });
    const findings = simulationFindings(sim, ATTACKER, WBNB, noLookup);
    const drainer = findings.find((f) => f.id === "erc20-drainer-pattern");
    // Called contract (WBNB) is the same token that moved → not a drainer
    expect(drainer).toBeUndefined();
  });
});

describe("Native-value drainer detection (ETH swap where output goes to non-user)", () => {
  it("flags HIGH when user sends native value and tokens go to ROUTER not user", () => {
    // Simulates: swapExactETHForTokens(0, [WBNB,BY], ROUTER, deadline)
    // User sends 0.1 BNB, BY tokens go to ROUTER not user → drainer
    const sim = baseSim({
      erc20Transfers: [
        { token: WBNB, from: ATTACKER, to: PAIR, amount: 10n ** 17n }, // WBNB wrapped
        { token: BY, from: PAIR, to: ROUTER, amount: 5_000n * 10n ** 18n }, // BY to ROUTER
      ],
    });
    const findings = simulationFindings(sim, ATTACKER, ROUTER, noLookup, 10n ** 17n);
    const drainer = findings.find((f) => f.id === "native-drainer-pattern");
    expect(drainer).toBeDefined();
    expect(drainer?.severity).toBe("high");
  });

  it("does NOT flag native drainer when user receives tokens at their own address", () => {
    // Normal: swapExactETHForTokens(0, [WBNB,BY], ATTACKER, deadline) → BY comes to ATTACKER
    const sim = baseSim({
      erc20Transfers: [
        { token: WBNB, from: ATTACKER, to: PAIR, amount: 10n ** 17n },
        { token: BY, from: PAIR, to: ATTACKER, amount: 5_000n * 10n ** 18n }, // goes to user
      ],
    });
    const findings = simulationFindings(sim, ATTACKER, ROUTER, noLookup, 10n ** 17n);
    const drainer = findings.find((f) => f.id === "native-drainer-pattern");
    expect(drainer).toBeUndefined();
  });

  it("does NOT flag native drainer when no native value was sent", () => {
    // ERC-20-only swap: user sends tokens and gets nothing back (different finding)
    const sim = baseSim({
      erc20Transfers: [
        { token: WBNB, from: ATTACKER, to: ROUTER, amount: 10n ** 17n },
        { token: BY, from: PAIR, to: ROUTER, amount: 5_000n * 10n ** 18n },
      ],
    });
    // sentValue = 0 → should NOT trigger native-drainer
    const findings = simulationFindings(sim, ATTACKER, ROUTER, noLookup, 0n);
    const drainer = findings.find((f) => f.id === "native-drainer-pattern");
    expect(drainer).toBeUndefined();
  });
});

describe("Large AMM burn detection (triggerAutoBurn pattern)", () => {
  it("flags HIGH when ≥2 ERC-20 transfers burn to address(0)", () => {
    const sim = baseSim({
      trace: { type: "CALL", from: ATTACKER, to: BY },
      erc20Transfers: [
        // Simulate triggerAutoBurn burning FROM pair reserves to zero
        { token: BY, from: PAIR, to: ZERO, amount: 50_000_000n * 10n ** 18n },
        { token: BY, from: PAIR, to: ZERO, amount: 30_000_000n * 10n ** 18n },
      ],
    });
    const findings = simulationFindings(sim, ATTACKER, BY, noLookup);
    const burnFinding = findings.find((f) => f.id === "large-reserve-burn");
    expect(burnFinding).toBeDefined();
    expect(burnFinding?.severity).toBe("high");
  });

  it("does NOT flag burn on a single burn transfer", () => {
    const sim = baseSim({
      erc20Transfers: [{ token: BY, from: ATTACKER, to: ZERO, amount: 100n * 10n ** 18n }],
    });
    const findings = simulationFindings(sim, ATTACKER, BY, noLookup);
    const burnFinding = findings.find((f) => f.id === "large-reserve-burn");
    expect(burnFinding).toBeUndefined();
  });
});
