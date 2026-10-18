import { describe, expect, it } from "vitest";
import { FIELD_CLASS_LISTS as CORE_LISTS, SYNTHETIC_NAMES as CORE_NAMES, buildSkeleton, checkReferences as coreRefs, fieldClass as coreClass, findGeneratedUnsafe, personaBundleProblem, type DataBundle, type DataSchema } from "@fitting-room/core";
import { FIELD_CLASS_LISTS, SYNTHETIC_NAMES, assertGeneratedSafe, assertPersonaBundle, checkReferences, fieldClass, type EntityGraph, type PersonaBundle } from "@fitting-room/fixtures";
import graphJson from "./test-support/generated/graph.json";
import passJson from "./test-support/generated/generated-pass.json";
import failJson from "./test-support/generated/generated-fail.json";

/** Copies of the fixtures package guard fixtures: the exported sample app has no packages/ source (scripts/export-sample-app), and JSON imports work in jsdom where import.meta.url is not a file URL. Any pass and fail bundle serves: the check is verdict parity. */
const graph = graphJson as unknown as EntityGraph;
const BUNDLES: Record<string, PersonaBundle> = {
  "generated-pass.json": passJson as unknown as PersonaBundle,
  "generated-fail.json": failJson as unknown as PersonaBundle,
};
const PATHS = [
  "reference", "technician.handle", "patientId", "accountNumber", "account.status", "orderCode", "codeReview", "displayName",
  "userName", "username", "customerName", "name", "dob", "dateOfBirth", "birthday", "address", "billingAddress.line1", "zipCode",
  "postcode", "city", "phoneNumber", "parts[2].serialNumber", "parts[].sku", "provider", "caseRef", "SKU", "customerID",
  "first_name", "last-name", "CONTACT_NAME", "technician_name", "contact.display_name", "owners[].owner_name", "customer_name", "Contact",
];
const OPTS = { key: "reference", identifierFields: ["caseRef"], nameFields: ["provider"] };

describe("the fixtures generated guard matches core's (spec R11 rule 2, FR-140)", () => {
  it("holds equal lists", () => {
    expect(FIELD_CLASS_LISTS).toEqual(CORE_LISTS);
    expect(SYNTHETIC_NAMES).toEqual(CORE_NAMES);
  });
  it.each(PATHS)("classes %s the same", (p) => {
    expect(fieldClass(p, "string", OPTS)).toBe(coreClass(p, "string", OPTS));
    expect(fieldClass(p, "enum", OPTS)).toBe(coreClass(p, "enum", OPTS));
  });
  it.each(["generated-pass.json", "generated-fail.json"])("gives the same verdict on %s", (f) => {
    const bundle = structuredClone(BUNDLES[f]!);
    const core: DataBundle = bundle;
    const hit = findGeneratedUnsafe(core, { graph })[0];
    const coreVerdict = hit ? `persona "${bundle.name}": ${hit.endpoint}/${hit.record} ${hit.path}: ${hit.class} field not in mechanical form` : undefined;
    let fixturesVerdict: string | undefined;
    try { assertGeneratedSafe(bundle, { graph }); } catch (e) { fixturesVerdict = (e as Error).message; }
    expect(coreVerdict === undefined).toBe(f === "generated-pass.json");
    expect(fixturesVerdict).toBe(coreVerdict);
  });
});

const msg = (f: () => void): string | undefined => { try { f(); return undefined; } catch (e) { return (e as Error).message; } };
const mutate = (f: (b: PersonaBundle) => void) => (b: PersonaBundle): PersonaBundle => { const c = structuredClone(b); f(c); return c; };
const MUTATIONS: Array<[string, (b: PersonaBundle) => PersonaBundle]> = [
  ["unchanged", (b) => structuredClone(b)],
  ["user not synthetic", mutate((b) => { (b.user.meta as { synthetic: boolean }).synthetic = false; })],
  ["role removed", mutate((b) => { b.user.data = {} as PersonaBundle["user"]["data"]; })],
  ["not visible to role", mutate((b) => { const f = Object.values(b.data)[0]!; f.visibleToRoles = ["other"]; })],
  ["identifier value", mutate((b) => { const f = Object.values(b.data)[0]!; f.data = { note: "ring 000-000-0000" }; })],
];

describe("core's reference and persona-bundle twins match fixtures (FR-142)", () => {
  it.each(Object.keys(BUNDLES).flatMap((f) => MUTATIONS.map((m) => [f, ...m] as const)))("%s, %s: same verdict and same reference problems", (f, _n, make) => {
    const bundle = make(BUNDLES[f]!);
    expect(personaBundleProblem(bundle as unknown as DataBundle)).toBe(msg(() => assertPersonaBundle(bundle)));
    expect(coreRefs(bundle, graph)).toEqual(checkReferences(bundle, graph));
  });
  it("a numeric-key skeleton resolves in both, and a String() mutation gives the same single problem", () => {
    const g: EntityGraph = {
      version: 1,
      entities: {
        site: { endpoint: "sites", key: "siteId", fields: { siteId: "number", label: "string" } },
        job: { endpoint: "jobs", key: "reference", fields: { reference: "string", siteId: "number" } },
      },
      references: [{ from: "job.siteId", to: "site" }],
    };
    const schema: DataSchema = { sites: { siteId: { type: "number" }, label: { type: "string" } }, jobs: { reference: { type: "string" }, siteId: { type: "number" } } };
    for (const rows of [5, 200]) {
      const sk = buildSkeleton({ graph: g, schema, seed: 5, rows });
      const bundle = { data: Object.fromEntries(Object.entries(sk.records).map(([e, r]) => [e, { data: r }])) };
      expect(coreRefs(bundle, g)).toEqual([]);
      expect(checkReferences(bundle, g)).toEqual([]);
      const jobs = bundle.data.jobs!.data as Record<string, { data: { siteId: unknown } }>;
      const k = Object.keys(jobs)[0]!;
      jobs[k]!.data.siteId = String(jobs[k]!.data.siteId);
      const a = coreRefs(bundle, g);
      expect(a).toHaveLength(1);
      expect(checkReferences(bundle, g)).toEqual(a);
    }
  });
});
