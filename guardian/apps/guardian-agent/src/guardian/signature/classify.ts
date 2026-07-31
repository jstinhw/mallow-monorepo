import { isAddress, type Address } from "viem";
import type { Finding, GuardianInput } from "../../protocol";
import { makeFinding } from "../risk";

// EIP-712 typed-data signature requests do not move funds at signing time, but
// they authorize on-chain actions a counterparty can submit later (token
// allowances, gasless transfers, NFT listings). The user sees no transaction in
// their history, so the danger is invisible without interpretation. This module
// classifies the typed data into a known authorization pattern and spells out
// the concrete outcome of signing — deterministically, before any LLM runs.

export type SignatureKind =
  | "erc2612-permit"
  | "dai-permit"
  | "permit2-single"
  | "permit2-batch"
  | "permit2-transfer"
  | "seaport-order"
  | "unknown-typed-data";

export type SignatureAnalysis = {
  kind: SignatureKind;
  primaryType: string;
  // The contract that recognizes this signature — where it can be redeemed.
  verifyingContract?: Address;
  domainName?: string;
  domainChainId?: number;
  // The party the signature grants power to (allowance spender / operator).
  spender?: Address;
  // The token whose movement is being authorized, when determinable.
  token?: Address;
  // The authorized amount in raw base units, when determinable.
  amount?: bigint;
  // Whether `amount` is effectively unbounded (≈ uint160/uint256 max).
  unlimited: boolean;
  // Unix-seconds expiry of the authorization, when determinable.
  deadline?: bigint;
  // One-line label, e.g. "Permit2 token allowance".
  title: string;
  // Plain-English statement of what signing authorizes.
  outcome: string;
  findings: Finding[];
};

const UINT160_MAX = (1n << 160n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
// Canonical "infinite" allowance values plus anything absurdly large. uint160
// max is the Permit2 sentinel; uint256 max is the ERC-2612 sentinel.
const UNLIMITED_FLOOR = UINT160_MAX;

function asAddress(v: unknown): Address | undefined {
  return typeof v === "string" && isAddress(v, { strict: false }) ? (v as Address) : undefined;
}

function asBigInt(v: unknown): bigint | undefined {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v.trim());
  } catch {
    return undefined;
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  const n = asBigInt(v);
  return n === undefined ? undefined : Number(n);
}

function isUnlimited(amount: bigint | undefined): boolean {
  return amount !== undefined && amount >= UNLIMITED_FLOOR && amount <= UINT256_MAX;
}

function record(message: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = message[key];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

// Cross-cutting safety checks that apply to every signature, regardless of kind:
// the verifying contract must match the address we were told to inspect, and the
// domain chainId must match the request chainId. A mismatch is a classic
// phishing tell — a malicious dApp signs you over a domain you didn't expect.
function baseFindings(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): Finding[] {
  const findings: Finding[] = [];
  if (verifyingContract && verifyingContract.toLowerCase() !== input.to.toLowerCase()) {
    findings.push(
      makeFinding({
        id: "verifying-contract-mismatch",
        severity: "high",
        title: "Signature domain points at a different contract",
        detail: `The typed data's verifyingContract (${verifyingContract}) is not the contract under review (${input.to}). The signature would be valid against an unexpected contract.`,
      }),
    );
  }
  if (domainChainId !== undefined && domainChainId !== input.chainId) {
    findings.push(
      makeFinding({
        id: "signature-chain-mismatch",
        severity: "low",
        title: "Signature is scoped to a different chain",
        detail: `The typed data's domain chainId is ${domainChainId}, but this request is on chain ${input.chainId}.`,
      }),
    );
  }
  return findings;
}

function allowanceFinding(args: {
  kind: SignatureKind;
  spender?: Address;
  token?: Address;
  amount?: bigint;
  unlimited: boolean;
  via: string;
}): Finding {
  const target = args.spender ? `${args.spender}` : "a spender";
  const tokenLabel = args.token ? `token ${args.token}` : "your tokens";
  if (args.unlimited) {
    return makeFinding({
      id: "unlimited-signed-allowance",
      severity: "high",
      title: "Signature grants an unlimited token allowance",
      detail: `Signing lets ${target} move an effectively unlimited amount of ${tokenLabel} from your wallet via ${args.via}. No further approval transaction is needed.`,
    });
  }
  return makeFinding({
    id: "signed-token-allowance",
    severity: "info",
    title: "Signature grants a token allowance",
    detail: `Signing lets ${target} move up to ${args.amount?.toString() ?? "an amount of"} base units of ${tokenLabel} from your wallet via ${args.via}. Verify the spender is one you trust.`,
  });
}

function classifyErc2612(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): SignatureAnalysis {
  const message = input.typedData!.message ?? {};
  const spender = asAddress(message.spender);
  const value = asBigInt(message.value);
  const deadline = asBigInt(message.deadline);
  const unlimited = isUnlimited(value);
  // For ERC-2612 the verifying contract IS the token being approved.
  const token = verifyingContract;
  const findings = baseFindings(input, verifyingContract, domainChainId);
  findings.push(
    allowanceFinding({
      kind: "erc2612-permit",
      spender,
      token,
      amount: value,
      unlimited,
      via: "an ERC-2612 permit",
    }),
  );
  return {
    kind: "erc2612-permit",
    primaryType: input.typedData!.primaryType,
    verifyingContract,
    domainName: domainNameOf(input),
    domainChainId,
    spender,
    token,
    amount: value,
    unlimited,
    deadline,
    title: "ERC-2612 token permit",
    outcome: `Authorizes ${spender ?? "a spender"} to spend ${unlimited ? "an unlimited amount of" : `${value?.toString() ?? "tokens"} base units of`} this token (${token ?? "the verifying contract"}) from your wallet, redeemable until ${formatDeadline(deadline)}.`,
    findings,
  };
}

function classifyDaiPermit(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): SignatureAnalysis {
  const message = input.typedData!.message ?? {};
  const spender = asAddress(message.spender);
  // DAI's permit is boolean (`allowed`) — it toggles an unlimited allowance.
  const allowed = message.allowed === true || message.allowed === "true";
  const deadline = asBigInt(message.expiry);
  const token = verifyingContract;
  const findings = baseFindings(input, verifyingContract, domainChainId);
  findings.push(
    allowanceFinding({
      kind: "dai-permit",
      spender,
      token,
      amount: undefined,
      unlimited: allowed,
      via: "a DAI-style permit",
    }),
  );
  return {
    kind: "dai-permit",
    primaryType: input.typedData!.primaryType,
    verifyingContract,
    domainName: domainNameOf(input),
    domainChainId,
    spender,
    token,
    amount: undefined,
    unlimited: allowed,
    deadline,
    title: "DAI-style token permit",
    outcome: allowed
      ? `Grants ${spender ?? "a spender"} an unlimited allowance over this token (${token ?? "the verifying contract"}) until ${formatDeadline(deadline)}.`
      : `Revokes ${spender ?? "a spender"}'s allowance over this token.`,
    findings,
  };
}

function classifyPermit2Single(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): SignatureAnalysis {
  const message = input.typedData!.message ?? {};
  const details = record(message, "details");
  const spender = asAddress(message.spender);
  const token = asAddress(details.token);
  const amount = asBigInt(details.amount);
  const expiration = asBigInt(details.expiration);
  const deadline = asBigInt(message.sigDeadline);
  const unlimited = isUnlimited(amount);
  const findings = baseFindings(input, verifyingContract, domainChainId);
  findings.push(
    allowanceFinding({
      kind: "permit2-single",
      spender,
      token,
      amount,
      unlimited,
      via: "Uniswap Permit2",
    }),
  );
  return {
    kind: "permit2-single",
    primaryType: input.typedData!.primaryType,
    verifyingContract,
    domainName: domainNameOf(input),
    domainChainId,
    spender,
    token,
    amount,
    unlimited,
    deadline: deadline ?? expiration,
    title: "Permit2 token allowance",
    outcome: `Authorizes ${spender ?? "a spender"} to pull ${unlimited ? "an unlimited amount of" : `${amount?.toString() ?? "tokens"} base units of`} ${token ?? "a token"} from your wallet through Permit2, until ${formatDeadline(expiration)}.`,
    findings,
  };
}

function classifyPermit2Batch(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): SignatureAnalysis {
  const message = input.typedData!.message ?? {};
  const spender = asAddress(message.spender);
  const rawDetails = Array.isArray(message.details) ? (message.details as unknown[]) : [];
  const items = rawDetails.map((d) => {
    const r = d && typeof d === "object" ? (d as Record<string, unknown>) : {};
    return { token: asAddress(r.token), amount: asBigInt(r.amount) };
  });
  const anyUnlimited = items.some((i) => isUnlimited(i.amount));
  const deadline = asBigInt(message.sigDeadline);
  const findings = baseFindings(input, verifyingContract, domainChainId);
  findings.push(
    allowanceFinding({
      kind: "permit2-batch",
      spender,
      token: items[0]?.token,
      amount: items[0]?.amount,
      unlimited: anyUnlimited,
      via: "Uniswap Permit2 (batch)",
    }),
  );
  return {
    kind: "permit2-batch",
    primaryType: input.typedData!.primaryType,
    verifyingContract,
    domainName: domainNameOf(input),
    domainChainId,
    spender,
    token: items[0]?.token,
    amount: items[0]?.amount,
    unlimited: anyUnlimited,
    deadline,
    title: "Permit2 batch allowance",
    outcome: `Authorizes ${spender ?? "a spender"} to pull ${items.length} token allowance${items.length === 1 ? "" : "s"} from your wallet through Permit2${anyUnlimited ? ", at least one of them unlimited" : ""}.`,
    findings,
  };
}

function classifyPermit2Transfer(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): SignatureAnalysis {
  const message = input.typedData!.message ?? {};
  const permitted = record(message, "permitted");
  const token = asAddress(permitted.token);
  const amount = asBigInt(permitted.amount);
  const deadline = asBigInt(message.deadline);
  const spender = asAddress(message.spender);
  const unlimited = isUnlimited(amount);
  const findings = baseFindings(input, verifyingContract, domainChainId);
  findings.push(
    makeFinding({
      id: "signed-token-transfer",
      severity: "medium",
      title: "Signature authorizes a one-time token transfer",
      detail: `Signing lets the recipient pull ${unlimited ? "an unlimited amount of" : `${amount?.toString() ?? "an amount of"} base units of`} ${token ?? "a token"} from your wallet via Permit2 SignatureTransfer. Funds move as soon as it is submitted.`,
    }),
  );
  return {
    kind: "permit2-transfer",
    primaryType: input.typedData!.primaryType,
    verifyingContract,
    domainName: domainNameOf(input),
    domainChainId,
    spender,
    token,
    amount,
    unlimited,
    deadline,
    title: "Permit2 signature transfer",
    outcome: `Authorizes a one-time transfer of ${unlimited ? "an unlimited amount of" : `${amount?.toString() ?? "tokens"} base units of`} ${token ?? "a token"} out of your wallet when submitted.`,
    findings,
  };
}

function classifySeaport(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): SignatureAnalysis {
  const findings = baseFindings(input, verifyingContract, domainChainId);
  findings.push(
    makeFinding({
      id: "seaport-order-signature",
      severity: "medium",
      title: "Signature authorizes an NFT/asset order",
      detail:
        "Signing creates a Seaport order. A counterparty can fulfill it to take the offered items from your wallet in exchange for the stated consideration. Confirm the offer and consideration match what you intend to trade.",
    }),
  );
  return {
    kind: "seaport-order",
    primaryType: input.typedData!.primaryType,
    verifyingContract,
    domainName: domainNameOf(input),
    domainChainId,
    unlimited: false,
    title: "Seaport order",
    outcome:
      "Creates a marketplace order that lets someone take the offered assets from your wallet in exchange for the stated consideration.",
    findings,
  };
}

function classifyUnknown(
  input: GuardianInput,
  verifyingContract?: Address,
  domainChainId?: number,
): SignatureAnalysis {
  const findings = baseFindings(input, verifyingContract, domainChainId);
  findings.push(
    makeFinding({
      id: "unclassified-typed-data",
      severity: "medium",
      title: "Unrecognized typed-data signature",
      detail: `Guardian could not match this "${input.typedData!.primaryType}" signature to a known pattern, so the exact outcome of signing is unverified. Treat it with caution unless you understand what the verifying contract does with it.`,
    }),
  );
  return {
    kind: "unknown-typed-data",
    primaryType: input.typedData!.primaryType,
    verifyingContract,
    domainName: domainNameOf(input),
    domainChainId,
    unlimited: false,
    title: `Typed data: ${input.typedData!.primaryType}`,
    outcome: `Unrecognized authorization. The verifying contract (${verifyingContract ?? input.to}) defines what this signature does — its effect could not be determined statically.`,
    findings,
  };
}

function domainNameOf(input: GuardianInput): string | undefined {
  const name = input.typedData?.domain?.name;
  return typeof name === "string" ? name : undefined;
}

function formatDeadline(deadline: bigint | undefined): string {
  if (deadline === undefined) return "an unspecified time";
  if (deadline === 0n || deadline >= UINT256_MAX) return "no expiry (never expires)";
  return `unix time ${deadline.toString()}`;
}

function typeHasField(types: Record<string, unknown>, typeName: string, field: string): boolean {
  const t = types[typeName];
  if (!Array.isArray(t)) return false;
  return t.some((f) => f && typeof f === "object" && (f as { name?: string }).name === field);
}

// Classify an EIP-712 typed-data request into a known authorization pattern.
// Detection keys off the primaryType and the shape of the `types` table, with
// the domain name as a tie-breaker — mirroring how wallets recognize permits.
export function classifySignature(input: GuardianInput): SignatureAnalysis {
  const td = input.typedData;
  if (!td) {
    throw new Error("classifySignature called without typedData");
  }
  const domain = td.domain ?? {};
  const types = td.types ?? {};
  const primaryType = td.primaryType;
  const verifyingContract = asAddress(domain.verifyingContract);
  const domainChainId = asNumber(domain.chainId);
  const domainName = typeof domain.name === "string" ? domain.name : undefined;

  if (primaryType === "PermitSingle")
    return classifyPermit2Single(input, verifyingContract, domainChainId);
  if (primaryType === "PermitBatch")
    return classifyPermit2Batch(input, verifyingContract, domainChainId);
  if (primaryType === "PermitTransferFrom" || primaryType === "PermitBatchTransferFrom") {
    return classifyPermit2Transfer(input, verifyingContract, domainChainId);
  }
  if (primaryType === "Permit") {
    if (typeHasField(types, "Permit", "allowed"))
      return classifyDaiPermit(input, verifyingContract, domainChainId);
    if (typeHasField(types, "Permit", "value"))
      return classifyErc2612(input, verifyingContract, domainChainId);
  }
  if (primaryType === "OrderComponents" || domainName === "Seaport") {
    return classifySeaport(input, verifyingContract, domainChainId);
  }
  return classifyUnknown(input, verifyingContract, domainChainId);
}
