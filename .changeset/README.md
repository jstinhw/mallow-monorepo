# Changesets

`@mallow/sdk` is the only published package; everything else is `private` and is
skipped automatically.

Run `pnpm changeset` when you change the SDK, describe the change, and commit the
generated markdown file. CI opens a release PR; merging it publishes to npm.
