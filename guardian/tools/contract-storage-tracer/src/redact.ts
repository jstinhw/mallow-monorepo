/**
 * Strips configured secrets out of any string on its way out of the process.
 *
 * The chain RPC URL carries `ALCHEMY_API_KEY` in its path (`chains.ts`), and viem puts the
 * whole URL into `HttpRequestError.message`. Without this, one failed RPC call would stream
 * the key to the browser over SSE, write it into the server log, and post it to the model.
 * Redacting at the three boundaries where bytes actually leave — the log stream, the SSE
 * frame, and the model request body — is one guard instead of one per thrower.
 */

/** Env vars whose values must never appear in output. */
const SECRET_ENV_VARS = [
  "ALCHEMY_API_KEY",
  "LLM_API_KEY",
  "RELAYER_PRIVATE_KEY",
  "ZERODEV_API_KEY",
] as const;

/** Below this a "secret" is a common substring, and redacting it would mangle real output. */
const MIN_SECRET_LENGTH = 8;

export const REDACTED = "[redacted]";

/**
 * ponytail: plain substring replacement, so a secret containing a character JSON escapes
 * (`"`, `\`) would survive inside a stringified frame. Provider keys, hex private keys and
 * UUIDs contain none. Escape the needles too if that ever stops holding.
 */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  return SECRET_ENV_VARS.reduce((out, name) => {
    const secret = env[name];
    return secret && secret.length >= MIN_SECRET_LENGTH ? out.split(secret).join(REDACTED) : out;
  }, text);
}
