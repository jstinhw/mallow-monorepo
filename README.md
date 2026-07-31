# Mallow

Monorepo for Mallow's core protocol and agent work.

| Project                  | What it is                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| [`graviton/`](#graviton) | Cross-chain intent protocol — contracts plus the services that run it |
| [`guardian/`](#guardian) | Agent that reviews a transaction before you sign it                   |
| [`sdk/`](#sdk)           | `@mallow/sdk` — the published client for both                         |
| [`wallet/`](#wallet)     | The Mallow wallet                                                     |

The marketing site and demo apps live in their own repositories; this one is
core logic.

## Layout

```
graviton/
  contracts/          Foundry — InteropExecutor, adapters, validators
  packages/core/      Shared ABIs, schemas, chain constants, oracles
  apps/server/        Intent API, order building, queueing
  apps/relayer/       Order execution + worker
  apps/quoter/        Pricing and route quotes
guardian/
  apps/guardian-agent/  Fastify service; streams a risk verdict over SSE
packages/
  agent-protocol/     Wire protocol between the wallet and agent services
sdk/                  @mallow/sdk
wallet/               Next.js wallet app
```

## Getting started

```sh
pnpm install
pnpm build          # turbo, respects the dependency graph
pnpm test
pnpm typecheck
pnpm lint
```

Contracts are outside the pnpm workspace so JS-only contributors don't need
Foundry installed:

```sh
pnpm contracts:build     # forge build --root graviton/contracts
pnpm contracts:test
```

Each service reads its own `.env`; copy the `.env.example` next to it. Local
Postgres and RabbitMQ for the Graviton services:

```sh
docker compose up -d
```

## Graviton

An intent is submitted to `apps/server`, priced by `apps/quoter`, and executed
by `apps/relayer` against the `InteropExecutor` contract on the source and
target chains. `packages/core` holds everything the three services agree on —
ABIs, zod schemas, chain constants.

## Guardian

`guardian/apps/guardian-agent` takes a transaction request (or EIP-712 typed
data) before it is signed, simulates it against an Anvil fork, resolves the
contracts involved via Sourcify and Etherscan, and streams a structured verdict:
risk level, findings, decoded call, simulated balance and storage diffs.

The model layer is provider-neutral and called over plain HTTP — point it at
Anthropic, OpenAI, Gemini, or a local server via env vars.

## SDK

```sh
npm install @mallow/sdk
```

```ts
import { createInteropClient } from "@mallow/sdk/graviton";
import { createGuardianClient } from "@mallow/sdk/guardian";

const guardian = createGuardianClient({ url: "https://guardian.example" });
const verdict = await guardian.check(request, {
  onProgress: (event) => console.log(event.stage),
});
```

Import from the subpaths rather than the root so bundlers only pull in what you
use. The root export re-exports both as `graviton` and `guardian` namespaces.

## Wallet

Next.js app. It talks to the Guardian service through its own API route and to
agent services over the `packages/agent-protocol` wire format.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed.
