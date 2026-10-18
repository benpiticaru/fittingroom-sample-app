import { describe, expect, it } from "vitest";
import { findObviousIdentifier } from "@fitting-room/core";
import { assertNoObviousIdentifiers } from "@fitting-room/fixtures";
import descriptor from "./src/muslin/descriptor.json";

/** Every value is synthetic (Constraint A): the same shapes the fixtures guard's own tests use. */
const CORPUS: unknown[] = [
  { mrn: "SYN-000912" }, { ssn: "123-45-6789" }, { contact: "pat.synthetic@example.com" },
  { note: "reach me at lab+tech@example.com today" }, { phone: "(248) 555-0100" }, { phone: "248-555-0100" },
  { phone: "+1 248 555 0100" }, { phone: "248.555.0100" }, { d: "2026-10-06" }, { at: "2026-10-06T14:30:00.000Z" },
  { u: "123e4567-e89b-12d3-a456-426614174000" }, { n: "2485550100" }, { dob: "1990-01-01" }, { birthDate: "2001-02-03" },
  { when: "1990-01-01" }, { list: ["ok", { deep: ["x", "123-45-6789"] }] }, { owner: "SYN-tech-07", pkg: "@fitting-room/core", handle: "@pat" },
  "pat.synthetic@example.com", 42, null, [],
];

const fixturesVerdict = (v: unknown): string | undefined => {
  try { assertNoObviousIdentifiers(v); return undefined; } catch (e) { return (e as Error).message; }
};

describe("the core identifier finder matches the fixtures guard", () => {
  it.each(CORPUS.map((v) => [JSON.stringify(v), v]))("%s", (_label, v) => {
    const hit = findObviousIdentifier(v);
    expect(hit ? `${hit.path}: looks like an identifier (${hit.kind})` : undefined).toBe(fixturesVerdict(v));
  });
});

// Constraint A: the host descriptor is hand-written config the panel shows to stakeholders.
describe("the sample app's host descriptor", () => {
  it("carries no obvious identifier", () => {
    expect(findObviousIdentifier(descriptor)).toBeUndefined();
    expect(() => assertNoObviousIdentifiers(descriptor)).not.toThrow();
  });
});
