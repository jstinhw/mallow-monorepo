import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import "fake-indexeddb/auto";

// Chain RPC URLs are built from the Alchemy key, so configure it for tests that
// build a wallet client. Set before chain config is imported — setupFiles run
// ahead of the test modules.
process.env.NEXT_PUBLIC_ALCHEMY_API_KEY ??= "test-alchemy-key";

// Extend with the wallet's own vitest rather than "@testing-library/jest-dom/vitest",
// which imports "vitest" from jest-dom's own location — unresolvable under pnpm's
// strict store layout once the wallet is a nested workspace package.
expect.extend(matchers);
