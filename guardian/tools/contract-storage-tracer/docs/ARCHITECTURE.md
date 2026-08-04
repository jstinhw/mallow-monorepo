# Architecture

## 1. Problem, stated precisely

**Input (seed):** a concrete call `{ chainId, from, to, data, block }`.

- `to` is the entry contract; `data` decodes (via the fetched ABI) to `selector` + args.
- `from` and the decoded args **concretize** the storage the call touches (the _anchor_).

**Output:**

1. **Compressed contracts** — every involved contract sliced to the anchor-touching
   functions (+ their transitive internal callees) and the relevant storage decls.
2. **Call chains** — every route `caller → … → storage op`, each with a _boundedness_ tag.

**Task type:** a _storage-anchored, cross-contract program slice_ over the global call
graph, where each backward hop's caller set is **derived from the code's access
constraints** rather than guessed or globally scanned.

## 2. The anchor

Storage is per-contract and per-slot. A mapping is not one slot: `allowance[o][s]` lives
at `keccak256(s ‖ keccak256(o ‖ p))` for base slot `p`. So the anchor is a _variable
identity_ plus a _key path_:

```
Anchor = { codehash, baseSlot p, variable "_allowances",
           keyPath [ key0=owner, key1=spender ], valueType }
```

The seed concretizes the key path (`owner = from`, `spender = decoded arg`). Concrete keys
are what let us pin `msg.sender` and bound caller sets. Without a concrete key path the
anchor stays at _variable granularity_ and boundedness degrades to `role-set` / `unbounded`.

## 3. "Touches" — direct and transitive

Function `f` in contract `C` **touches** anchor `A` iff:

- **direct:** `f` executes `SLOAD`/`SSTORE` on a slot in `A`, or
- **transitive:** `f` calls `g` (internal or external) that touches `A`.

The transitive clause _is_ the cross-contract link: a spender's method doesn't touch USDC
storage directly — it calls `USDC.transferFrom`, which does.

## 4. Boundedness — the heart of the system

For each toucher we compute the **authorized-caller set**: the set of `msg.sender` values
that can actually reach the touch of the _concrete_ anchor entry. Two deterministic
binding mechanisms feed it:

- **(B1) Key-as-caller binding.** If the anchor mapping is keyed by `msg.sender` in some
  dimension, and that dimension's concrete value is known from the seed, then `msg.sender`
  is _pinned_ to that value. `transferFrom` spends `_allowances[from][msg.sender]`; for the
  concrete entry `_allowances[owner][spender]`, key1 = `msg.sender` = `spender` → the only
  authorized caller is `spender`. **This is the "only the approved spender" rule, and it
  comes from the storage layout alone — no guard needed.**
- **(B2) Guard binding.** A `require` / `revert` / modifier on the path to the touch forces
  `msg.sender` to equal a key or a fixed/stored address (`onlyOwner`, `msg.sender == owner()`).

Combined, every toucher resolves to one of four **boundedness kinds**:

| Kind            | Meaning                                              | Example                                             | Recursion behaviour                                                                                        |
| --------------- | ---------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `singleton`     | Exactly these addresses can touch the concrete entry | `transferFrom` → `{spender}`; `approve` → `{owner}` | Enqueue those addresses. **Bounded.**                                                                      |
| `fixed-onchain` | `msg.sender` must equal a stored address             | `onlyOwner` → read `owner()` at block               | Read state → 1 address. **Bounded.**                                                                       |
| `role-set`      | `msg.sender` must be in a role/whitelist mapping     | `onlyRole(MINTER)`                                  | Not enumerable from a mapping; enumerate via role events / trace index, **capped**. **Bounded-by-oracle.** |
| `unbounded`     | No binding on `msg.sender` or key for this entry     | `function setBal(address a,uint v){ bal[a]=v; }`    | **Flag it, record the reason, do NOT expand blindly.** Coverage → `partial`.                               |

> **This is the answer to "call out if it's unbounded."** Unboundedness is a first-class
> result: it lands in `TraceReport.unbounded[]`, flips `coverage` to `partial`, and (for a
> permissionless writer to a security-relevant slot) is itself a finding worth surfacing.

Boundedness is computed by combining **key-provenance analysis** (where does each mapping
key come from: `msg.sender` / arg / storage / constant / derived?) with **guard extraction**
(path conditions to the access). Both are deterministic; hard/opaque cases fall to an
advisory LLM hypothesis that must be verified against an on-chain read (see §8).

## 5. The graph (SARG — Storage-Anchored Reachability Graph)

- **Node** = `(chainId, address, codehash, selector)` annotated with: storage-access set
  `{slot → read|write}`, its `boundedness`, and `verified` (source vs bytecode-only).
- **Edges:** `internal-call`, `external-call` (A.f → B.g, resolved target),
  `caller-of` (reverse, from the backward oracle), `shares-storage` (two fns of one
  contract on the same slot — this is the "all funcs touching the storage" listing).
- **Anchor** rides along each frontier task; cycles key on
  `(address, codehash, selector, anchorClass)`.

## 6. Pipeline

```
seed {chainId, from, to, data}
  │  RESOLVE-SEED (src/engine/resolve-seed.ts):
  ├─  ACQUIRE: source/ABI (Sourcify), proxy-resolve, compile, PIN block
  ├─  decode calldata against the TARGET's own ABI → selector + args
  │     (fallback: Sourcify 4byte signature DB → else "unknown")
  ├─  OBSERVE writes: simulate the call at the pinned block
  │     debug_traceCall prestate-diff → eth_createAccessList → static source scan
  ├─  ATTRIBUTE each written slot → layout variable + concrete key path
  │     (mappings via key-candidate preimage search; structs/arrays/packed via layout math)
  │     → one Anchor per written variable  (approve ⇒ a single allowance anchor)
  │  PER ANCHOR:
  ├─  CONSTRAINT/BOUNDEDNESS (deterministic core): key-provenance + guards → Boundedness
  ├─  EDGES + RECURSION: backward callers (= authorized-caller set from §4);
  │     shared BFS worklist across anchors; termination + unbounded flags
  ├─  SLICE: compress each contract; enumerate call chains
  ├─  ADVISE (optional, advisory-only): rank/label anchors; hypothesize opaque routes
  └─  REPORT: JSON (authoritative), one AnchorReport per written variable
```

## 7. Hard problems

| Problem                            | Handling                                                                                                                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mapping/array/struct/packed slots  | `analyze/layout.ts` + `analyze/attribute.ts`: observed slot → variable via layout math; mapping keys recovered by hashing seed-derived candidates (preimage search); packed members disambiguated by pre/post byte-range diff |
| Proxies / delegatecall             | Deterministic slot reads: **EIP-1967 + zeppelinos** implementations (`acquire/proxy.ts`); observations recorded under the proxy address, layout from the impl. UUPS/Beacon/Diamond: future                                    |
| Unverified contracts               | Currently: classified `unverified`, cannot descend (source unavailable). Bytecode adapter (symbolic `SLOAD`/`SSTORE` recovery, LLM-assisted): future                                                                          |
| Dynamic dispatch (`IERC20(t).x()`) | Resolve `t` by reading state at the pinned block; else `polymorphic`, optional LLM hypothesis (`unconfirmed`)                                                                                                                 |
| Backward caller discovery          | Driven by boundedness: `singleton`/`fixed-onchain` → direct; `role-set` → role events/trace, capped; `unbounded` → flag + stop                                                                                                |
| Path explosion                     | SCC condensation; k representative paths per (source, anchor); dedup by codehash                                                                                                                                              |
| State dependence                   | Pin `blockNumber` for the whole run; content-address code by codehash → reproducible                                                                                                                                          |
| Inline assembly / Yul              | Analyzer must cover assembly `sstore`/`sload` (Slither IR does; naive AST walks miss it)                                                                                                                                      |

## 8. Deterministic vs. LLM — the decision

**Deterministic core, model-agnostic LLM strictly at the edges (advisory only).**

Why the trust path is deterministic: the value proposition is a _sound, reproducible_
slice; slot math and dataflow are exactly what compilers/analyzers do deterministically;
`pin(block) + codehash → identical output` is testable, an LLM in the loop is not; and the
recursion touches hundreds of contracts where a static pass is instant.

LLMs earn their place only at the edges — each carrying `provenance:"hypothesis"`, never
changing the verified trace. **Two advisory tasks are wired** (`src/llm/tasks/`), both optional
and reached only through the single seam `src/engine/advise.ts`:

| Task                                                                              | When it runs                                        | Guardrail                                                                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anchor triage / labeling** — rank which written variables are security-relevant | the call writes >1 distinct variable                | only reorders + annotates; every anchor is still traced deterministically; rankings for variables not in the deterministic set are dropped |
| **Opaque-route hypotheses** — who controls a route's opaque key value             | a route was classified `opaque` / `role-set{trace}` | output tagged `provenance:"hypothesis"`; never mutates a `Boundedness` or `CallChain`                                                      |

All of this goes through one `ModelProvider` (`src/llm/provider.ts`), driven by an
OpenAI-compatible client (`src/llm/openai-compat.ts`) — LM Studio, Ollama, vLLM, or OpenAI,
selected purely by `LLM_BASE_URL`. Structured output is prompt-driven + zod-validated (portable
across servers). With `LLM_BASE_URL` unset (default), unreachable, or `--no-llm`, the report is
byte-identical to a fully deterministic run. (Deeper tasks — unverified-bytecode comprehension,
non-standard guard semantics — remain future work; the `ModelProvider` interface is ready for
them, and an Anthropic provider is a drop-in behind it.)

## 9. Output shapes

```jsonc
{
  "seedSummary": "USDC.approve(spender=0x… , amount) from 0xowner @ block 20000000",
  "block": 20000000,
  "compressedContracts": [
    {
      "address": "0xA0b8…USDC",
      "verified": true,
      "storage": ["mapping(address=>mapping(address=>uint256)) allowed // slot p"],
      "functions": ["approve", "transferFrom", "_approve", "_spendAllowance"],
      "sourceSlice": "contract USDC_slice { … }",
    },
    { "address": "0xRouter…", "functions": ["swap → USDC.transferFrom"], "…": "…" },
  ],
  "chains": [
    {
      "path": ["0xowner", "USDC.approve(SSTORE p)"],
      "op": "write",
      "boundedness": { "kind": "singleton", "callers": ["0xowner"] },
      "provenance": "verified",
    },
    {
      "path": ["EOA", "0xRouter.swap", "USDC.transferFrom", "USDC._spendAllowance(SSTORE p)"],
      "op": "read-write",
      "boundedness": { "kind": "singleton", "callers": ["0xRouter"] },
      "provenance": "verified",
    },
  ],
  "unbounded": [], // any permissionless toucher lands here
  "coverage": { "kind": "complete" }, // or { "partial", reasons:[ "unbounded@0x…", "maxDepth" ] }
}
```

## 10. Non-goals / assumptions

- One chain per run; cross-chain is out of scope for v1.
- Seed is a concrete call `{chainId, from, to, data}` (a tx hash is accepted and
  reduced to this shape). ABI-only seeds without concrete keys are supported but yield
  weaker boundedness (`role-set` / `unbounded`) by construction.
- Default anchor-propagation is `strict` (trace _this_ entry). A `dataflow` mode (spawn a
  new anchor when a hop reads the anchor and writes its own storage) is opt-in — without a
  bound it can traverse most of DeFi, so it is gated behind explicit config + limits.
