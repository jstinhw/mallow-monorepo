import { describe, it, expect, beforeEach } from "vitest";
import { saveWallet, loadWallet, deleteWallet, type StoredWallet } from "./storage";

const example: StoredWallet = {
  id: "11111111-1111-1111-1111-111111111111",
  address: "0x0000000000000000000000000000000000000001",
  credentialId: new Uint8Array([1, 2, 3]),
  ciphertext: new Uint8Array([4, 5, 6]),
  iv: new Uint8Array(12).fill(7),
  hkdfSalt: new Uint8Array(32).fill(8),
  prfSalt: new Uint8Array(32).fill(9),
  createdAt: 1,
};

beforeEach(async () => {
  await deleteWallet();
});

describe("wallet storage", () => {
  it("round-trips a wallet", async () => {
    await saveWallet(example);
    const back = await loadWallet();
    expect(back?.address).toBe(example.address);
    if (!back || back.kind === "injected") throw new Error("expected a passkey wallet");
    expect(Array.from(back.credentialId)).toEqual([1, 2, 3]);
  });

  it("returns null when empty", async () => {
    const back = await loadWallet();
    expect(back).toBeNull();
  });
});
