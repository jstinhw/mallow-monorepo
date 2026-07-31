---
"@mallow/sdk": minor
---

Initial release of the unified Mallow SDK.

`graviton-sdk` is now `@mallow/sdk`, exposed at the `@mallow/sdk/graviton`
subpath, and a new `@mallow/sdk/guardian` subpath adds a client for the Guardian
transaction-safety agent: `createGuardianClient({ url }).check(request, { onProgress })`
streams the agent's progress and resolves with its verdict.
