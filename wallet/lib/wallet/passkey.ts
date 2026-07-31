import { asBuffer } from "./crypto";
import { PASSKEY_NAME, RP_ID, RP_NAME } from "@/lib/constants/passkey";

export function prfSupported(): boolean {
  if (typeof window === "undefined") return false;
  return typeof PublicKeyCredential !== "undefined";
}

type PrfClientResults = { prf?: { results?: { first?: ArrayBuffer | Uint8Array } } };

function readPrfFirst(out: AuthenticationExtensionsClientOutputs): Uint8Array | undefined {
  const prf = (out as unknown as PrfClientResults).prf;
  const first = prf?.results?.first;
  if (!first) return undefined;
  return first instanceof Uint8Array ? new Uint8Array(first) : new Uint8Array(first);
}

export async function registerPasskey(prfSalt: Uint8Array): Promise<{
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
}> {
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: { id: RP_ID, name: RP_NAME },
    user: { id: asBuffer(userId), name: PASSKEY_NAME, displayName: PASSKEY_NAME },
    challenge: asBuffer(challenge),
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    timeout: 60_000,
    extensions: {
      prf: { eval: { first: asBuffer(prfSalt) } },
    } as unknown as AuthenticationExtensionsClientInputs,
  };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation cancelled.");

  const credentialId = new Uint8Array(cred.rawId);
  const prfFromCreate = readPrfFirst(cred.getClientExtensionResults());
  if (prfFromCreate) return { credentialId, prfOutput: prfFromCreate };

  const second = await getPrfFromPasskey(credentialId, prfSalt);
  return { credentialId, prfOutput: second };
}

export async function getPrfFromPasskey(
  credentialId: Uint8Array,
  prfSalt: Uint8Array,
): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: asBuffer(challenge),
    rpId: RP_ID,
    allowCredentials: [{ id: asBuffer(credentialId), type: "public-key" }],
    userVerification: "required",
    timeout: 60_000,
    extensions: {
      prf: { eval: { first: asBuffer(prfSalt) } },
    } as unknown as AuthenticationExtensionsClientInputs,
  };
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey ceremony cancelled.");
  const out = readPrfFirst(cred.getClientExtensionResults());
  if (!out)
    throw new Error(
      "Passkey did not return a PRF output. Your browser/platform may not support PRF.",
    );
  return out;
}
