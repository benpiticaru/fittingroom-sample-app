// @vitest-environment node
// FR-145: the walkthrough quotes the gate's refusal line as docs/reference/generated-data.md gives it (the run's refusal named the planner persona), and carries no unfilled placeholder.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoFile } from "./repo-file";

const DOC = repoFile("docs/generated-data-fitting.md");
const REF = repoFile("docs/reference/generated-data.md");
const LINE = (role: string) => `generated fixtures changed since approval: ${role}`;

// The standalone export carries no docs beyond the first-fitting walkthrough.
describe.skipIf(!existsSync(DOC) || !existsSync(REF))("docs/generated-data-fitting.md", () => {
  it("quotes the refusal line the reference documents", () => {
    expect(readFileSync(REF, "utf8")).toContain(LINE("<role>"));
    expect(readFileSync(DOC, "utf8")).toContain(`\n${LINE("planner")}\n`);
  });

  it("holds no placeholder marker and no skeleton wording", () => {
    const doc = readFileSync(DOC, "utf8");
    expect(doc).not.toContain("FR-145 PLACEHOLDER");
    expect(doc).not.toContain("Part 1 skeleton");
  });
});
