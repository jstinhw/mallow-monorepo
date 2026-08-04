# mallowallet

## 0.0.1

### Major Changes

- feat: graviton

### Minor Changes

- cd28686: Initial release of the unified Mallow SDK.

  `graviton-sdk` is now `mallowallet`, exposed at the `mallowallet/graviton`
  subpath, and a new `mallowallet/guardian` subpath adds a client for the Guardian
  transaction-safety agent: `createGuardianClient({ url }).check(request, { onProgress })`
  streams the agent's progress and resolves with its verdict.
