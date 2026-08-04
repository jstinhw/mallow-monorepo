import { z } from "zod";

const blankAsUndefined = (v: unknown): unknown => (v === "" ? undefined : v);
const optionalUrl = z.preprocess(blankAsUndefined, z.string().url().optional());
const optionalString = z.preprocess(blankAsUndefined, z.string().optional());

export const envSchema = z.object({
  MAX_DEPTH: z.coerce.number().int().positive().default(4),
  MAX_ADDRESSES: z.coerce.number().int().positive().default(50),
  ALCHEMY_API_KEY: z.string().min(1, "ALCHEMY_API_KEY is required"),
  TAG_SERVICE_URL: optionalUrl,
  TRACE_LOG: z.string().default("1"),
  LLM_BASE_URL: optionalUrl,
  LLM_MODEL: z.preprocess(blankAsUndefined, z.string().min(1).default("local-model")),
  LLM_API_KEY: optionalString,
});
