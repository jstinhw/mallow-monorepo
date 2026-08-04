# contract-storage-tracer

Given a **concrete call** — `{ chainId, from, to, calldata }` — compute every **route**
and every **compressed contract** that can touch the **same storage** as that call,
recursively across contracts, and **explicitly flag any frontier that is unbounded**.

Works for **any transaction**, not just `approve`. The tracer decodes the calldata against
the target's own ABI (falling back to public signature databases), **observes which storage
slots the call writes** by simulating it at a pinned block (`debug_traceCall` prestate diff,
then `eth_createAccessList`, then a static source scan), attributes each written slot back to
a layout variable and its concrete key path, and traces every anchor.

The canonical example: seed a `USDC.approve(spender, amount)` call and the tracer finds that
the approval entry `allowed[from][spender]` can only be moved by the `owner` (via `approve` /
`increaseAllowance`) and by the **approved spender** (via `transferFrom`). It then fetches the
spender contract, finds the function that calls `transferFrom`, and recurses — terminating
cleanly because every hop's caller set is *bounded by the code's own access constraints*. A
`USDC.transfer(...)` seed instead produces two `balanceAndBlacklistStates[...]` anchors; a
`mint(...)` produces three (`balanceAndBlacklistStates`, `totalSupply_`, `minterAllowed`) —
the same machinery, no ERC-20-specific code.

## Two deliverables

1. **Compressed contracts** — each involved contract sliced down to the code coupled to the
   anchor via a **storage-coupling closure**, with the **real source extracted** (by AST
   byte-offset) so a human or LLM can read it. Given `A→anchor`, `B→anchor,I`, `C→I`, `D→∅`,
   the slice keeps functions `{A,B,C}` and storage `{anchor,I}` and drops `D` — e.g. for a
   USDC allowance trace it keeps the 10 allowance functions + `allowed`, and drops
   `transfer`/`mint`/`balances`. Spenders (no storage anchor) are sliced by call-closure
   from the `transferFrom` reachers. The slice is exported for an LLM to optionally read.
2. **Call chains** — ordered routes `caller → … → storage op`, each tagged with its
   **boundedness** and provenance.

## The core idea: bounded vs. unbounded

A function *touches* the anchor if it reads/writes the anchor slot **or calls something
that does**. For each toucher we compute an **authorized-caller set** — who can actually
reach that touch — from two deterministic signals:

- **Key-as-caller binding.** The anchor mapping is keyed by `msg.sender` in some
  dimension (`_allowances[from][msg.sender]`). Once the seed concretizes the entry, that
  dimension pins `msg.sender` → a **singleton** ("only the approved spender").
- **Guard binding.** A `require` / modifier forces `msg.sender` to a key or a stored
  address (`onlyOwner`, `msg.sender == owner()`).

If **no** toucher binds `msg.sender` to the concrete entry, the caller set is everyone →
**`unbounded`**. The tracer does **not** silently expand it; it flags the node, records
*why*, and marks coverage `partial`. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the full boundedness taxonomy.

## Pipeline

```
resolve-seed:   loadContract → decode vs the target's ABI (fallback: Sourcify 4byte signature DB)
                → observe writes (debug_traceCall prestate-diff → eth_createAccessList → static)
                → attribute raw slots → layout variables + concrete key paths
                → per written variable: analyze who touches it
per anchor:     classify caller boundedness → backward-recurse over callers
advise:         optional, advisory-only LLM annotations (see below)
assemble-report: one AnchorReport per written variable; slices/addresses deduped
```

## Design stance: fully deterministic core, advisory model layer

The whole trust path — decode, storage observation, slot attribution, dataflow,
constraint/boundedness solving, graph traversal, slicing — is **100% deterministic and
reproducible** (pin block + codehash → byte-identical output). It is built as a
**tool for LLM agents** — the compressed slices and call chains it emits are shaped for an agent
(or a human) to read downstream.

A **model-agnostic advisory layer**, when configured via `LLM_BASE_URL`/`LLM_MODEL` (any
OpenAI-compatible server — LM Studio, Ollama, vLLM, OpenAI), adds two things: it
**ranks/labels** which written variables are security-relevant, and **hypothesizes** who
controls an opaque route's key value. Both are strictly advisory — triage only
reorders/annotates the report, hypotheses are tagged `provenance:"hypothesis"` — and never
change the verified trace. Pass `--no-llm` to skip it for one run and get a model-free,
byte-identical-on-rerun report; an unreachable model degrades the same way.

## Quickstart

```bash
cp .env.example .env      # set ALCHEMY_API_KEY; optionally set LLM_BASE_URL / LLM_MODEL.
                          # RPC endpoints are fixed per chain (src/chains.ts), Alchemy tried
                          # first. Where the endpoint supports debug_traceCall or
                          # eth_createAccessList, dynamic observation kicks in, else it
                          # falls back to a static source scan and still traces
npm install
npm run typecheck

npm run trace -- --chain 1 \
  --from  0x<owner> \
  --to    0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --calldata 0x095ea7b3...   # approve(spender, amount)  — or any calldata

# options: --block <n> (pin a block) · --anchor <var> (trace one written variable) · --no-llm
```

## Examples (verified live against mainnet)

`npm run examples` runs three real seeds end-to-end (live RPC + Sourcify + in-process solc) and
self-checks the result (23/23 assertions): two `approve` seeds and one **general `transfer`**
seed that proves the pipeline is no longer approve-only.

| | Example 1 | Example 2 | Example 3 |
|---|---|---|---|
| Seed | EOA approves USDC to **an EOA** | EOA approves USDC to **Uniswap** (`SwapRouter02`) | EOA **transfers** USDC |
| Anchor(s) | `allowed[owner][spender]` @ slot 10 — **slot verified against on-chain `allowance()`** | same | `balanceAndBlacklistStates[from]` and `[to]` — **observed writes** |
| `approve` / `increase` / `decrease` | `singleton{owner}` | `singleton{owner}` | — |
| `transferFrom` | `singleton{spender}` — the **only approved spender** | `singleton{SwapRouter02}` | (balance touchers) |
| `permit` ×2, `allowance` | **unbounded** (flagged) | **unbounded** (flagged) | — |
| Recursion | spender is an EOA → **leaf, stops** (1 contract) | descends into Uniswap, resolves each entrypoint's `from` provenance, emits **full chains** `owner → SwapRouter02.pull → USDC.transferFrom` (**2 contracts**), terminates at the owner | traces who else can move each balance |

The recursion into a spender resolves, per entrypoint, the provenance of the `from` it hands
to `transferFrom`:

```
[read-write] owner → SwapRouter02.pull                     → USDC.transferFrom   singleton{owner}
[read-write] owner → SwapRouter02.swapExactTokensForTokens  → USDC.transferFrom   singleton{owner}
[read-write] <opaque caller> → SwapRouter02.uniswapV3SwapCallback → USDC.transferFrom  (from = decoded callback data)
```

`from = msg.sender` pins the caller back to the **owner** (recurse; the owner is the terminal
actor → "no new address" → converges); the swap callback's `from` comes from decoded callback
data, so it is flagged **opaque**. If a spender instead passed a caller-supplied `from`, that
entrypoint is flagged **unbounded** — a permissionless pull of the owner's approved funds.

The full JSON reports land in `examples/out/`. This is the "only the approved spender can
touch the anchor" rule (`transferFrom → singleton{spender}`), the recursive chains, and the
unbounded/opaque flagging working on the real USDC + Uniswap contracts (compiled from Sourcify).

### Step log

Every pipeline step is logged to **stderr** (the JSON report keeps stdout), so
`npm run trace -- … > report.json` still yields clean JSON while the terminal shows:

```
[trace]  1. connect chain 1 · pinned block 25444602
[trace]  3. load token 0xA0b8…48 · resolve proxy → impl → compile
[trace]       → FiatTokenV2_2 (impl 0x4350…) · 21 storage vars
[trace]  6. verify slot vs on-chain allowance() · match=true
[trace]  8. backward recursion (worklist) · frontier 2
[trace]       → visit 0x68b3…Fc45 [transferFrom] · depth 1 · contract
[trace]         · SwapRouter02 → 4 entrypoints reach transferFrom
[trace]         · pull: safeTransferFrom(from=msg.sender) → caller-is-owner
[trace]         · uniswapV3SwapCallback: safeTransferFrom(from=derived:data.payer) → opaque
[trace]       → visit 0x28C6…1d60 [transferFrom] · depth 2 · eoa   (no new address → converges)
[trace]  9. done · 11 chains · 2 contracts · 3 unbounded · coverage partial
```

Silence it with `TRACE_LOG=0`.

### Address classification

Every address the recursion touches is classified from three signals and reported under
`addresses` (and used to decide whether to descend):

1. **code** — `getCode`, but **EIP-7702-aware**: code `0xef0100…` is a *delegated EOA*, not
   a contract (common on mainnet now — e.g. `vitalik.eth` returns 23 bytes of delegation);
2. **sent txs** — the account nonce: *no code + sent txs ⇒ EOA*, whereas *no code + never
   sent ⇒ `undetermined`* (an unused EOA **or** an undeployed/counterfactual contract — an
   approval to such an address is **flagged**, since a contract could later be deployed there);
3. **tags** — ENS reverse resolution (keyless), plus an optional external label service via
   `TAG_SERVICE_URL`.

```
0xd8dA6BF2…96045 · eoa · nonce 5898 · vitalik.eth · 7702→0x5a7fc113…   (delegated EOA, not a contract)
0x68b34658…65Fc45 · contract · SwapRouter02
```

## Layout

```
src/
  types/     domain model — seed, anchor, constraints/boundedness, SARG, report
  acquire/   data layer — calldata decode + signature lookup, contract load
             + proxy resolution + cache, and dynamic storage observation (observe.ts)
  analyze/   deterministic analysis — solc compile, storage-layout math (layout.ts),
             slot attribution (attribute.ts), key candidates, static write scan,
             the anchor/caller boundedness analyzer, and source slicing
  engine/    pipeline phases — resolve-seed → classify-touchers → recurse-callers →
             advise → assemble-report, plus the shared session
  llm/       model-agnostic advisory layer — provider, OpenAI-compat client,
             registry, and the two advisory tasks (tasks/)
docs/        ARCHITECTURE.md (design)
test/        vitest unit tests + the LM Studio integration test (auto-skips if offline)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and boundedness taxonomy.
