// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertPersonaBundle } from "@fitting-room/fixtures";
import type { Fixture, FixtureSet } from "@fitting-room/fixtures";
import type { Job } from "../api/types";
import { dispatcherBundle, jobFixtures, toJobFixtures } from "./dispatcher";

const personas = fileURLToPath(new URL("./personas/", import.meta.url));
const exampleSession = fileURLToPath(new URL("../../.fitting-room/sessions/example-fitting.json", import.meta.url));

describe("dispatcher persona bundle", () => {
  it("passes assertPersonaBundle", () => {
    expect(() => assertPersonaBundle(dispatcherBundle)).not.toThrow();
  });

  it("matches the <personas>/<role>/ layout", () => {
    // FR-145: generated personas (user.json `meta.source: "generated"`, gated by `fit fixtures approve`) sit beside the
    // one hand-written bundle; the hand-written set stays exactly the dispatcher.
    const generated = (role: string): boolean =>
      (JSON.parse(readFileSync(`${personas}${role}/user.json`, "utf8")) as { meta?: { source?: string } }).meta?.source === "generated";
    const roles = readdirSync(personas, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .filter((role) => !generated(role));
    expect(roles).toEqual(["dispatcher"]);
    expect(roles[0]).toBe(dispatcherBundle.name);
    expect(roles[0]).toBe(dispatcherBundle.user.data.role);
    const endpoints = readdirSync(`${personas}${roles[0]}`)
      .filter((f) => !f.startsWith(".") && f.endsWith(".json") && f !== "user.json")
      .map((f) => f.slice(0, -".json".length))
      .sort();
    expect(endpoints).toEqual(Object.keys(dispatcherBundle.data).sort());
  });

  it("resolves every fixtures[] reference in the committed example session", () => {
    const session = JSON.parse(readFileSync(exampleSession, "utf8")) as { fixtures: string[] };
    expect(session.fixtures.length).toBeGreaterThan(0);
    for (const id of session.fixtures) expect(Object.keys(jobFixtures), id).toContain(id);
  });

  it("refuses a non-synthetic record nested in an endpoint set", () => {
    const [id, record] = Object.entries(jobFixtures)[0]!;
    const bad = {
      meta: { edges: [], synthetic: true },
      data: { [id]: { ...record, meta: { ...record.meta, synthetic: false } } },
    } as unknown as Fixture<FixtureSet<Job>>;
    expect(() => toJobFixtures(bad)).toThrow(/must be marked synthetic/);
  });
});
