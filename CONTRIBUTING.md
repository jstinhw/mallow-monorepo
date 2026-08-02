# Contributing

## Setup

Node 20+, pnpm 10, and (for contracts only) Foundry.

```sh
git clone --recurse-submodules https://github.com/jstinhw/mallow.git
cd mallow
pnpm install
```

`--recurse-submodules` matters: `graviton/contracts/lib/forge-std` is a
submodule. If you already cloned without it, run `git submodule update --init`.

## Before you open a PR

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

CI runs exactly these, plus `forge fmt --check`, `forge build` and `forge test`
for the contracts.

## Conventions

- **Task running** is Turborepo. Add a script to a package and it is picked up;
  declare cross-package ordering in `turbo.json`, not by hand.
- **Formatting** is Prettier, and it is per-project on purpose. `graviton/` uses
  single quotes at 80 columns, `sdk/` single quotes at 100, everything else
  double quotes at 100. Prettier picks the nearest config — do not "fix" a file
  to another project's style.
- **Linting** is a shared flat config, `eslint.config.base.mjs`. `any` and
  non-null assertions are warnings, not errors; a leading `_` marks a
  deliberately unused binding.
- **Runtime dependency versions are not unified.** Graviton runs fastify 4 and
  zod 3; Guardian and the wallet run fastify 5 and zod 4. pnpm keeps both. Do
  not bump one project's major to match another's without a migration.

## Changing the SDK

`mallowallet` is the only published package. Every change to it needs a
changeset:

```sh
pnpm changeset
```

Describe the change, commit the generated file with your PR. Merging to `main`
opens a release PR; merging that publishes to npm.

## Adding a package

Put it under the project it belongs to (`graviton/apps/*`,
`graviton/packages/*`, `guardian/apps/*`) or in `packages/` if more than one
project uses it. Mark it `"private": true` unless it is meant to be published.
Give it `build`, `test`, `typecheck` and `lint` scripts so Turbo can see it.

## Security

Please do not open a public issue for a vulnerability. See
[SECURITY.md](SECURITY.md).
