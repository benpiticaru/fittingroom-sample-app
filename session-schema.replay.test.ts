// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { draftAlterations, isFittingId, renderMarkdown, type Fitting } from "@fitting-room/core";
import { assertNoObviousIdentifiers } from "@fitting-room/fixtures";
import { repoFile } from "./repo-file";

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));
const session = read("./.fitting-room/sessions/example-fitting.json") as Fitting;
const schema = JSON.parse(readFileSync(repoFile("schema/fitting.schema.json"), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

describe("committed example session", () => {
  it("resolves ajv v8", () => {
    expect(createRequire(import.meta.url)("ajv/package.json").version).toMatch(/^8\./);
  });

  it("validates against schema/fitting.schema.json", () => {
    expect(validate(session), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("has an id that passes isFittingId, and an attempt branch derived from it", () => {
    expect(isFittingId(session.id)).toBe(true);
    expect(session.attempt?.branch).toBe(`fitting/${session.id}`);
  });

  it("contains no obvious identifiers", () => {
    expect(() => assertNoObviousIdentifiers(session)).not.toThrow();
  });

  describe("rendered alterations", () => {
    const md = renderMarkdown(draftAlterations(session));
    const pins = session.pins;

    it("shows every utterance verbatim, inert in a fenced block (FR-107)", () => {
      for (const p of pins) expect(md).toContain("```\n" + p.utterance + "\n```");
    });
    it("diffs config against real before values", () => {
      const layout = pins.find((p) => p.configPatch)!;
      expect(layout.configPatch!.before).toEqual(read("./src/features/jobs/tableConfig.json").columnOrder);
      expect(md).toContain(`- columnOrder: ${JSON.stringify(layout.configPatch!.before)}`);
      expect(md).toContain("@@ src/features/jobs/tableConfig.json @@");
    });
    it("has one acceptance criterion per pin (three)", () => {
      expect(pins).toHaveLength(3);
      const section = md.split("## Acceptance criteria")[1]!.split("\n## ")[0]!;
      expect(section.match(/^- \[ \] /gm)).toHaveLength(3);
    });
    it("flags the data gap as backend with an impliedField that only the muslin overlay carries", () => {
      const gap = pins.find((p) => p.kind === "data-gap")!;
      expect(gap.scope).toBe("backend");
      const name = gap.impliedField!.name;
      expect(read("./src/features/jobs/tableConfig.muslin.json").placeholderColumns.map((c: { name: string }) => c.name)).toContain(name);
      expect(JSON.stringify(read("./src/features/jobs/tableConfig.json"))).not.toContain(name);
    });
    it("carries the facilitator's stopped-with-question triage", () => {
      expect(md).toContain("## Triage");
      expect(md).toContain("**Stopped**");
      expect(md).toMatch(/Question: .+\?/);
    });
  });
});
