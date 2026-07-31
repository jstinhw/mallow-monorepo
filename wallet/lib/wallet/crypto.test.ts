import { describe, it, expect } from "vitest";
import { deriveKey, encryptKey, decryptKey, randomBytes } from "./crypto";

describe("wallet crypto", () => {
  it("HKDF is deterministic for the same inputs", async () => {
    const prf = randomBytes(32);
    const salt = randomBytes(32);
    const k1 = await deriveKey(prf, salt);
    const k2 = await deriveKey(prf, salt);
    const raw1 = new Uint8Array(await crypto.subtle.exportKey("raw", k1));
    const raw2 = new Uint8Array(await crypto.subtle.exportKey("raw", k2));
    expect(Array.from(raw1)).toEqual(Array.from(raw2));
  });

  it("encrypt/decrypt round-trip", async () => {
    const prf = randomBytes(32);
    const salt = randomBytes(32);
    const key = await deriveKey(prf, salt);
    const pk = randomBytes(32);
    const { ciphertext, iv } = await encryptKey(key, pk);
    const back = await decryptKey(key, ciphertext, iv);
    expect(Array.from(back)).toEqual(Array.from(pk));
  });

  it("decrypt rejects wrong key", async () => {
    const pk = randomBytes(32);
    const k1 = await deriveKey(randomBytes(32), randomBytes(32));
    const k2 = await deriveKey(randomBytes(32), randomBytes(32));
    const { ciphertext, iv } = await encryptKey(k1, pk);
    await expect(decryptKey(k2, ciphertext, iv)).rejects.toBeTruthy();
  });

  it("each encrypt produces a fresh IV", async () => {
    const prf = randomBytes(32);
    const salt = randomBytes(32);
    const key = await deriveKey(prf, salt);
    const pk = randomBytes(32);
    const a = await encryptKey(key, pk);
    const b = await encryptKey(key, pk);
    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
  });
});
