import {
  decodeFunctionData,
  parseAbiItem,
  slice,
  toFunctionSelector,
  type AbiFunction,
  type AbiParameter,
  type Hex,
} from "viem";
import type { StepLogger } from "../log";
import { signatureLookupSchema } from "../schemas/decode";
import { fetchWithBackoff } from "../utils/net";

export interface DecodedCall {
  readonly selector: Hex;
  readonly functionName: string;
  readonly args: readonly unknown[];
  /** Parameter definitions (names + types) when a matching signature was found. */
  readonly inputs?: readonly AbiParameter[];
  /** Where the decode came from — how much to trust the argument names/types. */
  readonly source: "contract-abi" | "signature-db" | "unknown";
}

/** Locates the ABI function whose selector matches, to recover its input parameter list. */
function inputsFor(
  abi: readonly unknown[],
  selector: Hex,
  functionName: string,
): readonly AbiParameter[] | undefined {
  for (const item of abi as readonly AbiFunction[]) {
    if (item.type !== "function" || item.name !== functionName) continue;
    try {
      if (toFunctionSelector(item) === selector) return item.inputs;
    } catch {
      // malformed ABI item — skip
    }
  }
  return undefined;
}

function withInputs(
  base: Omit<DecodedCall, "inputs">,
  inputs: readonly AbiParameter[] | undefined,
): DecodedCall {
  return inputs ? { ...base, inputs } : base;
}

/** Decodes calldata against a specific ABI. Returns undefined when no function matches. */
export function decodeAgainstAbi(
  calldata: Hex,
  abi: readonly unknown[],
  source: DecodedCall["source"],
): DecodedCall | undefined {
  const selector = slice(calldata, 0, 4);
  try {
    const { functionName, args } = decodeFunctionData({ abi, data: calldata });
    return withInputs(
      { selector, functionName, args: args ?? [], source },
      inputsFor(abi, selector, functionName),
    );
  } catch {
    return undefined;
  }
}

/** Tries each candidate text signature (e.g. "transfer(address,uint256)") until one decodes. */
function decodeAgainstSignatures(
  calldata: Hex,
  signatures: readonly string[],
): DecodedCall | undefined {
  for (const sig of signatures) {
    try {
      const item = parseAbiItem(`function ${sig}`) as AbiFunction;
      const decoded = decodeAgainstAbi(calldata, [item], "signature-db");
      if (decoded) return decoded;
    } catch {
      // unparseable signature string — try the next candidate
    }
  }
  return undefined;
}

const SOURCIFY_4BYTE_URL = "https://api.4byte.sourcify.dev/signature-database/v1/lookup";

/**
 * Resolves a 4-byte selector to candidate text signatures via Sourcify's 4byte signature service
 * (https://docs.sourcify.dev/docs/api/#/4byte-signature-service-api-documentation), openchain.xyz-
 * compatible. Used only when the target contract's own ABI can't decode the calldata. Signatures
 * seen on a verified contract are tried first — the more likely candidate on a selector collision.
 */
async function fetchSignatures(selector: Hex, fetchFn: typeof fetch): Promise<readonly string[]> {
  try {
    const res = await fetchWithBackoff(
      `${SOURCIFY_4BYTE_URL}?function=${selector}&filter=true`,
      undefined,
      { fetchFn },
    );
    if (!res.ok) return [];
    const parsed = signatureLookupSchema.safeParse(await res.json());
    if (!parsed.success || !parsed.data.ok) return [];
    const matches = parsed.data.result.function?.[selector] ?? [];
    return [...matches]
      .sort((a, b) => Number(b.hasVerifiedContract) - Number(a.hasVerifiedContract))
      .map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Decodes a seed's calldata, preferring the target contract's own ABI, then falling back to
 * Sourcify's signature database, then to an opaque `unknown` result. The pipeline never fails on a
 * decode: an `unknown` call still traces, with anchor key candidates limited to `from`/`to`.
 */
export async function decodeSeedCall(
  calldata: Hex,
  abi: readonly unknown[] | undefined,
  log: StepLogger,
  fetchFn: typeof fetch = fetch,
): Promise<DecodedCall> {
  const selector = slice(calldata, 0, 4);

  if (abi && abi.length > 0) {
    const fromAbi = decodeAgainstAbi(calldata, abi, "contract-abi");
    if (fromAbi) return fromAbi;
  }

  const signatures = await fetchSignatures(selector, fetchFn);
  const fromDb = decodeAgainstSignatures(calldata, signatures);
  if (fromDb) {
    log.sub(`selector ${selector} decoded via Sourcify signature lookup as ${fromDb.functionName}`);
    return fromDb;
  }

  log.sub(
    `selector ${selector} not in contract ABI or the Sourcify signature database — decoding as unknown`,
  );
  return { selector, functionName: "unknown", args: [], source: "unknown" };
}
