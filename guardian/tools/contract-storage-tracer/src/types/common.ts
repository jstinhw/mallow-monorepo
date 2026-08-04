/** read | write | read-write, used for storage access classification. */
export type Access = "read" | "write" | "read-write";

/** Marks whether a fact was established deterministically (`verified`) or is an
 *  unconfirmed hypothesis awaiting on-chain verification. */
export type Provenance = "verified" | "hypothesis";
