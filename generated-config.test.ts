// @vitest-environment node
// FR-145 (R11 GD6): the sample app declares the name fields the fixed list cannot know.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFittingroomConfig } from "@fitting-room/agent";
import { fieldClass } from "@fitting-room/core";

const APP = fileURLToPath(new URL(".", import.meta.url));
const data = parseFittingroomConfig(JSON.parse(readFileSync(join(APP, ".fitting-room/config.json"), "utf8"))).muslin.data!;
const opts = { nameFields: data.nameFields, identifierFields: data.identifierFields };

describe("the sample app's muslin.data declaration", () => {
  it("declares customerName, and the declaration is what classes it", () => {
    expect(fieldClass("customerName", "string", opts)).toBe("person-name");
    expect(fieldClass("customerName", "string", {})).toBeUndefined();
  });
  it("leaves the fixed-list classes to the fixed list", () => {
    expect(fieldClass("technician.displayName", "string", opts)).toBe("person-name");
    expect(fieldClass("address", "string", opts)).toBe("address");
    expect(fieldClass("technician.handle", "string", opts)).toBe("identifier");
  });
  it("points types at a file that exists", () => {
    expect(existsSync(join(APP, data.types!))).toBe(true);
  });
});
