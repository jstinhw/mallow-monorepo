import { openDB, type IDBPDatabase } from "idb";
import {
  DB_NAME,
  DB_VERSION,
  LEGACY_STORE_AUTO_INVEST,
  STORE_AGENT_INSTALLATIONS,
  STORE_SESSION_KEYS,
  STORE_WALLETS,
} from "@/lib/constants/db";

export { STORE_WALLETS, STORE_SESSION_KEYS, STORE_AGENT_INSTALLATIONS } from "@/lib/constants/db";

export function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE_WALLETS)) d.createObjectStore(STORE_WALLETS);
      if (!d.objectStoreNames.contains(STORE_SESSION_KEYS)) d.createObjectStore(STORE_SESSION_KEYS);
      if (!d.objectStoreNames.contains(STORE_AGENT_INSTALLATIONS))
        d.createObjectStore(STORE_AGENT_INSTALLATIONS);
      if (d.objectStoreNames.contains(LEGACY_STORE_AUTO_INVEST))
        d.deleteObjectStore(LEGACY_STORE_AUTO_INVEST);
    },
  });
}
