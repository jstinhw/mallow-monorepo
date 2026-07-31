// Runtime validation for the agent wire contract. The canonical types live in
// @mallow/agents-protocol (shared with the agent service); these Zod schemas
// are checked AGAINST those types via `satisfies` so parsing can't drift from
// the contract. Only the wallet parses inbound agent payloads, so this layer
// lives here rather than in the shared package.
import { z } from "zod";
import type { Hex, Address } from "viem";
import type {
  AgentRequest,
  AgentRequestAccount,
  AgentRequestTxAction,
  AgentRequestSigAction,
  AgentRequestAction,
  Eip712TypedData,
  AgentInstallResponse,
} from "@mallow/agents-protocol";

const HEX_RE = /^0x[0-9a-fA-F]*$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const INTEGER_RE = /^(0|[1-9][0-9]*)$/;

const nonEmptyStringSchema = (field: string) =>
  z.string().refine((value) => value.trim().length > 0, {
    message: `${field} must be a non-empty string`,
  });

export const hexStringSchema = (field = "value") =>
  nonEmptyStringSchema(field).refine((value): value is Hex => HEX_RE.test(value), {
    message: `${field} must be hex`,
  });

export const addressSchema = (field = "address") =>
  nonEmptyStringSchema(field).refine((value): value is Address => ADDRESS_RE.test(value), {
    message: `${field} must be an address`,
  });

export const agentRequestAccountSchema = z.discriminatedUnion("type", [
  z.object({
    address: addressSchema("account.address"),
    type: z.literal("eoa"),
    data: hexStringSchema("account.data"),
  }),
  z.object({
    address: addressSchema("account.address"),
    type: z.literal("smart_account"),
    data: hexStringSchema("account.data"),
  }),
]) satisfies z.ZodType<AgentRequestAccount>;

export const agentRequestTxActionSchema = z.object({
  kind: z.literal("tx"),
  chainId: z.number().int().positive(),
  to: addressSchema("action.to"),
  data: hexStringSchema("action.data"),
  value: nonEmptyStringSchema("action.value").refine((value) => INTEGER_RE.test(value), {
    message: "action.value must be an integer string",
  }),
}) satisfies z.ZodType<AgentRequestTxAction>;

export const eip712TypedDataSchema = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: nonEmptyStringSchema("action.typedData.primaryType"),
  message: z.record(z.string(), z.unknown()),
}) satisfies z.ZodType<Eip712TypedData>;

// `kind` is a single "sig" literal so the action union below can stay keyed on
// `kind`; the message-vs-typedData split lives on the nested `payload.type`.
export const agentRequestSigActionSchema = z.object({
  kind: z.literal("sig"),
  chainId: z.number().int().positive(),
  signer: addressSchema("action.signer"),
  payload: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("message"),
      message: hexStringSchema("action.payload.message"),
    }),
    z.object({
      type: z.literal("typedData"),
      typedData: eip712TypedDataSchema,
    }),
  ]),
}) satisfies z.ZodType<AgentRequestSigAction>;

export const agentRequestActionSchema = z.preprocess(
  (input) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
    const record = input as Record<string, unknown>;
    return record.kind === undefined ? { ...record, kind: "tx" } : record;
  },
  z.discriminatedUnion("kind", [agentRequestTxActionSchema, agentRequestSigActionSchema]),
) satisfies z.ZodType<AgentRequestAction>;

export const agentRequestSchema = z.object({
  name: nonEmptyStringSchema("name"),
  description: nonEmptyStringSchema("description"),
  accounts: z.array(agentRequestAccountSchema),
  actions: z.array(agentRequestActionSchema).min(1, "actions must not be empty"),
}) satisfies z.ZodType<AgentRequest>;

export const agentInstallResponseSchema = z.object({
  agentId: nonEmptyStringSchema("agentId"),
}) satisfies z.ZodType<AgentInstallResponse>;

export function parseAgentRequest(input: unknown): AgentRequest {
  return parseWithSchema(agentRequestSchema, input, "agent request");
}

export function parseAgentInstallResponse(input: unknown): AgentInstallResponse {
  return parseWithSchema(agentInstallResponseSchema, input, "install response");
}

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(`${label} invalid: ${formatZodIssues(result.error.issues)}`);
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
