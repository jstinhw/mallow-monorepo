import { z } from "zod";

// EIP-712 typed-data structure, per https://eips.ethereum.org/EIPS/eip-712.
//
// An `eth_signTypedData_v4` payload is a JSON object with four REQUIRED keys:
// `types`, `primaryType`, `domain`, `message`. This schema validates that
// structure, the EIP-712 type-string grammar, the canonical `EIP712Domain`
// fields, and the two cross-field invariants the spec imposes:
//   1. `primaryType` must be a key in `types`.
//   2. every member type that is not atomic must reference a struct defined in
//      `types` (EIP712Domain is implicitly available).
//
// Recursive validation of `message` against the resolved primary type is
// intentionally NOT done here — the downstream classifier reads the message
// defensively, and over-strict message validation would reject otherwise-valid
// signatures whose encoding the signer (viem) handles.

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

// An EIP-712 type string: a base type optionally suffixed by one or more array
// markers `[]` (dynamic length) or `[N]` (fixed length), e.g. `uint256`,
// `address[]`, `Person[2][]`. The base must be a valid Solidity identifier;
// whether it resolves to an atomic type or a defined struct is enforced by the
// cross-field refinement below.
const TYPE_STRING = /^[A-Za-z_$][A-Za-z0-9_$]*(\[\d*\])*$/;

const eip712Member = z.object({
  name: z.string().min(1),
  type: z.string().regex(TYPE_STRING, "invalid EIP-712 type string"),
});

const eip712Types = z.record(z.string(), z.array(eip712Member));

// chainId arrives as a JSON number over `eth_signTypedData_v4`, but as a decimal
// or hex string over WalletConnect — accept all three forms. (The signer
// normalizes it to a number for the domain separator downstream.)
const uint256ish = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^(0x[0-9a-fA-F]+|\d+)$/),
]);

// The five canonical EIP712Domain fields, all optional — "protocol designers
// only need to include the fields that make sense for their signing domain."
// Extra fields are preserved (`catchall`) rather than rejected, since some
// dApps attach non-canonical domain members.
const eip712Domain = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    chainId: uint256ish.optional(),
    verifyingContract: z.string().regex(ADDRESS).optional(),
    salt: z.string().regex(BYTES32).optional(),
  })
  .catchall(z.any());

const ATOMIC = new Set(["bool", "address", "string", "bytes"]);

function baseType(type: string): string {
  // Strip every trailing array marker: `Foo[2][]` → `Foo`.
  return type.replace(/(\[\d*\])+$/, "");
}

function isAtomicType(type: string): boolean {
  if (ATOMIC.has(type)) return true;
  if (/^bytes([1-9]|[12]\d|3[0-2])$/.test(type)) return true; // bytes1..bytes32
  const m = /^u?int(\d+)$/.exec(type); // uint8..uint256 / int8..int256
  if (m) {
    const bits = Number(m[1]);
    return bits >= 8 && bits <= 256 && bits % 8 === 0;
  }
  return false;
}

export const typedDataSchema = z
  .object({
    types: eip712Types,
    primaryType: z.string().min(1),
    domain: eip712Domain,
    message: z.record(z.string(), z.any()),
  })
  .superRefine((data, ctx) => {
    if (!(data.primaryType in data.types)) {
      ctx.addIssue({
        code: "custom",
        path: ["primaryType"],
        message: `primaryType "${data.primaryType}" is not defined in types`,
      });
    }
    for (const [typeName, members] of Object.entries(data.types)) {
      for (const member of members) {
        const base = baseType(member.type);
        if (isAtomicType(base) || base === "EIP712Domain") continue;
        if (!(base in data.types)) {
          ctx.addIssue({
            code: "custom",
            path: ["types", typeName],
            message: `member "${member.name}" references undefined type "${base}"`,
          });
        }
      }
    }
  });

export type TypedData = z.infer<typeof typedDataSchema>;
