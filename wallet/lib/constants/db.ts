// Single source of truth for the "mallow" IndexedDB. All persistent
// browser state lives in this one database, partitioned by object store.
// Bumping DB_VERSION requires adding the corresponding step in getDB().upgrade().
export const DB_NAME = "mallow";
export const DB_VERSION = 5;

export const STORE_WALLETS = "wallets";
export const STORE_SESSION_KEYS = "session-keys";
export const STORE_AGENT_INSTALLATIONS = "agent-installations";

// Legacy store for the in-wallet auto-invest engine, since removed. Dropped on
// upgrade so old databases don't keep a dangling, unused object store.
export const LEGACY_STORE_AUTO_INVEST = "auto-invest";
