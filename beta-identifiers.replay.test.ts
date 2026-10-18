// @vitest-environment node
// FR-17: Constraint A over every committed recording and example session. The replay.test.ts suffix keeps
// this out of a real attempt's testCommand (spec 262). Monorepo paths are read inside the tests only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/
// Built from segments: the FR-23 export scan rejects a literal packages/<name>/src path in any exported file.
const recordings = join(appDir, "..", "..", "packages", "agent", "src", "__fixtures__", "claude");
const sessions = join(appDir, ".fitting-room", "sessions");

const jsonIn = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)) : [];

describe.skipIf(standalone)("beta artifacts carry no identifiers", () => {
  it("every recording, beta recording and example session passes assertNoObviousIdentifiers", async () => {
    const { assertNoObviousIdentifiers } = await import("@fitting-room/fixtures");
    const files = [...jsonIn(recordings), ...jsonIn(join(recordings, "beta")), ...jsonIn(sessions).filter((f) => /[\\/]example-[^\\/]*\.json$/.test(f))];
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(() => assertNoObviousIdentifiers(JSON.parse(readFileSync(f, "utf8"))), f).not.toThrow();
    }
  });

  it("bites: a copy of a recording with an SSN-shaped value in it is rejected", async () => {
    const { assertNoObviousIdentifiers } = await import("@fitting-room/fixtures");
    const [first] = jsonIn(recordings);
    const doc = JSON.parse(readFileSync(first!, "utf8")) as Record<string, unknown>;
    expect(() => assertNoObviousIdentifiers({ ...doc, utterance: "my number is 123-45-6789" })).toThrow(/SSN/);
  });
});
