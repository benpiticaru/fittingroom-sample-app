import { describe, expect, it } from "vitest";
import baseConfig from "../features/jobs/tableConfig.json";
import { HttpClient, resolveHost } from "./client";

// client.ts is production-only: it has no flag branch and never reaches the muslin. The muslin swaps it
// at build time (muslin.aliases.api); the swap is proved by muslin-bundle.test.ts and dev-muslin.live.test.ts.
describe("resolveHost (production client)", () => {
  it("returns the HttpClient and the static base config", async () => {
    const host = await resolveHost();
    expect(host.client).toBeInstanceOf(HttpClient);
    expect(host.store.get()).toEqual(baseConfig);
    expect(host.store.get().placeholderColumns).toBeUndefined();
  });
});
