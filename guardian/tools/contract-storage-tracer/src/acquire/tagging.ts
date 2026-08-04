import type { Address, PublicClient } from "viem";
import { fetchWithBackoff } from "../utils/net";

export interface AddressTags {
  /** ENS reverse name, when set. */
  readonly ens?: string;
  /** Free-text labels from an external tagging service. */
  readonly labels: readonly string[];
}

/** Approach #3: "send the request to some service tagging the address." Pluggable so the
 *  keyless ENS default can be combined with, or replaced by, an external label service. */
export interface AddressTagger {
  tag(address: Address): Promise<AddressTags>;
}

const EMPTY: AddressTags = { labels: [] };

/** Keyless tagger: ENS reverse resolution (mainnet, at latest block). Resolution
 *  failures degrade to no tag. */
export function ensTagger(client: PublicClient): AddressTagger {
  return {
    async tag(address) {
      try {
        const ens = await client.getEnsName({ address });
        return ens ? { ens, labels: [] } : EMPTY;
      } catch {
        return EMPTY;
      }
    },
  };
}

/**
 * Generic external tagging service: GET `${baseUrl}/${address}` expecting
 * `{ labels?: string[], name?: string }`. Point it at any label API (Etherscan, Arkham,
 * a custom index) via `TAG_SERVICE_URL`. No-ops (never fetches) when `baseUrl` is unset.
 * Failures degrade to no tags.
 */
export function httpTagger(baseUrl?: string): AddressTagger {
  return {
    async tag(address) {
      if (!baseUrl) return EMPTY;
      try {
        const res = await fetchWithBackoff(`${baseUrl.replace(/\/$/, "")}/${address}`);
        if (!res.ok) return EMPTY;
        const data = (await res.json()) as { labels?: string[]; name?: string };
        const labels = [...(data.name ? [data.name] : []), ...(data.labels ?? [])];
        return { labels };
      } catch {
        return EMPTY;
      }
    },
  };
}

/** Runs several taggers and merges their results. */
export function combineTaggers(taggers: readonly AddressTagger[]): AddressTagger {
  return {
    async tag(address) {
      const all = await Promise.all(
        taggers.map((t) => t.tag(address).catch((): AddressTags => EMPTY)),
      );
      const ens = all.find((t) => t.ens)?.ens;
      const labels = [...new Set(all.flatMap((t) => t.labels))];
      return { ...(ens ? { ens } : {}), labels };
    },
  };
}

/** Builds the default tagger: ENS, plus an external service when `tagServiceUrl` is set. */
export function createTagger(client: PublicClient, tagServiceUrl?: string): AddressTagger {
  return combineTaggers([ensTagger(client), httpTagger(tagServiceUrl)]);
}
