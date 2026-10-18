// @vitest-environment node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FacilitatorAgent } from "@fitting-room/agent";

const APP = fileURLToPath(new URL(".", import.meta.url));
const load = async (rel: string): Promise<string> => readFile(join(APP, rel), "utf8");

describe("FacilitatorAgent is unchanged by the git agent", () => {
  it("FacilitatorAgent.attempt on the FR-8 example session is byte-identical to the golden", async () => {
    const fitting = JSON.parse(await load(".fitting-room/sessions/example-fitting.json"));
    const out = await new FacilitatorAgent().attempt({ fitting, repoPath: APP, baseBranch: "main" });
    expect(JSON.stringify(out, null, 2) + "\n").toBe(await load("__golden__/facilitator-attempt.json"));
  });

  it("the golden equals the attempt recorded in the committed example session", async () => {
    const session = JSON.parse(await load(".fitting-room/sessions/example-fitting.json"));
    expect(JSON.parse(await load("__golden__/facilitator-attempt.json"))).toEqual(session.attempt);
  });
});
