// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWalkthrough, tokenize } from "./walkthrough";

const doc = [
  "# Title",
  "```sh",
  "fit not-executed",
  "```",
  "```fit",
  "fit fitting start --role \"dispatch lead\" --screen \"Jobs worklist\"",
  "",
  "# a comment",
  "```",
  "```json muslin-edit src/features/jobs/tableConfig.json",
  "{ \"density\": \"compact\" }",
  "```",
  "```fit",
  "fit pin \"$FITTING\" \"I'd like the technician first\"",
  "```",
].join("\n");

describe("parseWalkthrough", () => {
  it("returns fit lines and muslin edits in document order, ignoring other fences, blanks and # comments", () => {
    expect(parseWalkthrough(doc)).toEqual([
      { kind: "fit", line: 'fitting start --role "dispatch lead" --screen "Jobs worklist"' },
      { kind: "edit", file: "src/features/jobs/tableConfig.json", patch: { density: "compact" } },
      { kind: "fit", line: 'pin "$FITTING" "I\'d like the technician first"' },
    ]);
  });
  it("rejects a fit line that does not start with `fit `", () => {
    expect(() => parseWalkthrough("```fit\nnpm test\n```")).toThrow(/must start with "fit "/);
  });
  it("rejects a muslin-edit block that is not a JSON object", () => {
    expect(() => parseWalkthrough("```json muslin-edit a.json\n[1]\n```")).toThrow(/JSON object/);
  });
});

describe("tokenize", () => {
  it("keeps double-quoted text with apostrophes as one argument", () => {
    expect(tokenize(`pin x "I'd like it" --kind layout`, {})).toEqual(["pin", "x", "I'd like it", "--kind", "layout"]);
  });
  it("supports single quotes", () => {
    expect(tokenize(`pin x 'say "hi"'`, {})).toEqual(["pin", "x", 'say "hi"']);
  });
  it("expands $FITTING bare or inside double quotes", () => {
    expect(tokenize(`pin "$FITTING" $FITTING`, { FITTING: "s.json" })).toEqual(["pin", "s.json", "s.json"]);
  });
  it("fails on an unknown or unbound variable", () => {
    expect(() => tokenize(`pin "$OTHER"`, { FITTING: "s.json" })).toThrow(/unbound variable \$OTHER/);
  });
  it("fails on an unterminated quote", () => {
    expect(() => tokenize(`pin "oops`, {})).toThrow(/unterminated quote/);
  });
});
