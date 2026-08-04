import solcWrapper from "solc";
import type { VerifiedSource } from "../acquire/sourcify";

/** solc's storageLayout entry for one state variable (or struct member). */
export interface StorageLayoutItem {
  readonly label: string;
  readonly slot: string;
  readonly offset: number;
  readonly type: string;
}

/**
 * solc's storageLayout `types` entry, keyed by the `type` id used in StorageLayoutItem.
 * `encoding` drives slot math: `inplace` (value/struct/fixed-array), `mapping`, `dynamic_array`,
 * `bytes` (bytes/string). `key`/`value` describe mappings, `base` arrays, `members` structs.
 */
export interface SolcTypeInfo {
  readonly encoding: "inplace" | "mapping" | "dynamic_array" | "bytes";
  readonly label: string;
  readonly numberOfBytes: string;
  readonly key?: string;
  readonly value?: string;
  readonly base?: string;
  readonly members?: readonly StorageLayoutItem[];
}

export interface Compiled {
  readonly contractName: string;
  readonly storage: readonly StorageLayoutItem[];
  /** The storageLayout `types` map. Empty for compilers that don't emit it (pre-0.5.13);
   *  consumers then fall back to parsing the `type` string of each StorageLayoutItem. */
  readonly storageTypes: Record<string, SolcTypeInfo>;
  /** Compact AST per source file. Inherited state/functions live across files, so the
   *  analyzer indexes all of them and resolves `referencedDeclaration` ids globally. */
  readonly asts: Record<string, unknown>;
  /** Raw source per file, so slices can be extracted by AST `src` byte offsets. */
  readonly sources: Record<string, string>;
  readonly abi: readonly unknown[];
}

interface SolcModule {
  version(): string;
  compile(input: string): string;
}

const compilerCache = new Map<string, Promise<SolcModule>>();

function loadCompiler(version: string): Promise<SolcModule> {
  const tag = `v${version}`;
  const cached = compilerCache.get(tag);
  if (cached) return cached;
  const loading = new Promise<SolcModule>((resolve, reject) => {
    (
      solcWrapper as {
        loadRemoteVersion(v: string, cb: (e: Error | null, s: SolcModule) => void): void;
      }
    ).loadRemoteVersion(tag, (err, mod) => (err ? reject(err) : resolve(mod)));
  });
  compilerCache.set(tag, loading);
  return loading;
}

interface SolcOutput {
  readonly errors?: readonly { readonly severity: string; readonly formattedMessage?: string }[];
  readonly contracts?: Record<
    string,
    Record<
      string,
      {
        readonly storageLayout?: {
          storage: StorageLayoutItem[];
          types?: Record<string, SolcTypeInfo> | null;
        };
        readonly abi?: unknown[];
      }
    >
  >;
  readonly sources?: Record<string, { readonly ast?: unknown }>;
}

/**
 * Compiles verified sources with the contract's own compiler version and returns the
 * authoritative storage layout + AST. Deterministic: same sources + version → same layout.
 */
export async function compile(source: VerifiedSource): Promise<Compiled> {
  const solc = await loadCompiler(source.compilerVersion);
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(source.sources).map(([p, content]) => [p, { content }]),
    ),
    settings: {
      optimizer: source.settings.optimizer ?? { enabled: true, runs: 200 },
      ...(source.settings.evmVersion ? { evmVersion: source.settings.evmVersion } : {}),
      outputSelection: { "*": { "*": ["storageLayout", "abi"], "": ["ast"] } },
    },
  };

  const out = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput;
  const fatal = (out.errors ?? []).filter((e) => e.severity === "error");
  if (fatal.length > 0) {
    throw new Error(
      `solc ${source.compilerVersion} failed:\n${fatal
        .slice(0, 3)
        .map((e) => e.formattedMessage)
        .join("\n")}`,
    );
  }

  const asts = Object.fromEntries(
    Object.entries(out.sources ?? {})
      .filter(([, v]) => v.ast !== undefined)
      .map(([file, v]) => [file, v.ast]),
  );

  for (const contracts of Object.values(out.contracts ?? {})) {
    const hit = contracts[source.contractName];
    if (hit) {
      return {
        contractName: source.contractName,
        storage: hit.storageLayout?.storage ?? [],
        storageTypes: hit.storageLayout?.types ?? {},
        asts,
        sources: source.sources,
        abi: hit.abi ?? [],
      };
    }
  }
  throw new Error(`compiled output missing contract ${source.contractName}`);
}
