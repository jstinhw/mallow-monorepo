const enc = new TextEncoder();

export function asBuffer(u8: Uint8Array): ArrayBuffer {
  // Strip the SharedArrayBuffer-compatible generic by copying into a fresh ArrayBuffer.
  return u8.slice().buffer as ArrayBuffer;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export async function deriveKey(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", asBuffer(prfOutput), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: asBuffer(salt), info: enc.encode("mallow:wallet:v1") },
    ikm,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function encryptKey(
  key: CryptoKey,
  pk: Uint8Array,
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: asBuffer(iv) }, key, asBuffer(pk)),
  );
  return { ciphertext: ct, iv };
}

export async function decryptKey(
  key: CryptoKey,
  ciphertext: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    key,
    asBuffer(ciphertext),
  );
  return new Uint8Array(pt);
}
