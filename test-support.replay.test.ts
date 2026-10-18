// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tempDirs } from "@fitting-room/agent/testing";
import type { TurnRecord } from "@fitting-room/agent";
import type { Fitting } from "@fitting-room/core";
import { normalize } from "./test-support/normalize";
import { toRecording } from "./test-support/recordings";
import { recordingTransport } from "./test-support/transport";
import { withFakeGh } from "./test-support/gh-exec";
import { replayScript } from "./test-support/replay-script";

const temp = tempDirs();
const appDir = fileURLToPath(new URL(".", import.meta.url));
const standalone = existsSync(join(appDir, ".fitting-room-export")); // FR-23 export has no packages/

const turn = (n: number, role: TurnRecord["role"], body: unknown, extra: Partial<TurnRecord> = {}): TurnRecord => ({
  schema: "fitting-room/turn@1",
  fitting: "fit-0b7e5a17",
  pin: `pin-${n}`,
  n,
  agent: "claude",
  role,
  at: "2026-01-01T00:00:00.000Z",
  request: { system: "x" },
  response: { status: 200, body },
  ...extra,
});
const reply = (id: string, toolId: string) => ({
  id,
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "ok" }, { type: "tool_use", id: toolId, name: "record_pin", input: { kind: "layout" } }],
});

describe("normalize", () => {
  it("replaces the fitting id, ISO times and the build id", () => {
    const f = { id: "fit-0b7e5a17", muslinBuild: "abc123", startedAt: "2026-01-01T00:00:01.000Z", branch: { name: "fitting/fit-0b7e5a17" }, pins: [] } as unknown as Fitting;
    expect(normalize(f)).toEqual({ id: "<fitting-id>", muslinBuild: "<build>", startedAt: "<time>", branch: { name: "fitting/<fitting-id>" }, pins: [] });
  });
});

describe("normalize live-edit fields", () => {
  it("maps shas, ms and the harness path prefix, and leaves a session without liveEdit alone", () => {
    const pins = [
      { id: "pin-1", liveEdit: { status: "kept", commit: "a".repeat(40), paths: ["examples/sample-app/src/A.tsx"], ms: 1234 } },
      { id: "pin-2", liveEdit: { status: "reverted", commit: "b".repeat(40), revertCommit: "c".repeat(40), paths: ["src/B.tsx"], ms: 9 } },
      { id: "pin-3", liveEdit: { status: "not-kept", reason: "question", question: "Which one?", ms: 5 } },
      { id: "pin-4" },
    ];
    const f = { id: "fit-0b7e5a17", muslinBuild: "x", pins, attempt: { outcome: "pr-opened", branch: "b", filesChanged: ["examples/sample-app/src/A.tsx", "other.txt"], testsUpdated: [] } } as unknown as Fitting;
    const n = normalize(f) as { pins: Array<Record<string, any>>; attempt: { filesChanged: string[] } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(n.pins[0]!.liveEdit).toEqual({ status: "kept", commit: "<sha>", paths: ["src/A.tsx"], ms: "<ms>" });
    expect(n.pins[1]!.liveEdit).toEqual({ status: "reverted", commit: "<sha>", revertCommit: "<sha>", paths: ["src/B.tsx"], ms: "<ms>" });
    expect(n.pins[2]!.liveEdit).toEqual({ status: "not-kept", reason: "question", question: "Which one?", ms: "<ms>" });
    expect(n.pins[3]).toEqual({ id: "pin-4" });
    expect(n.attempt.filesChanged).toEqual(["src/A.tsx", "other.txt"]);
  });
});

describe("recordingTransport", () => {
  it("serves in order and re-stringifies the parsed body", async () => {
    const t = recordingTransport([{ response: { status: 200, body: { a: 1 } } }, { response: { status: 529, body: { b: [2] } } }]);
    const init = {} as never;
    const one = await t("u", init);
    expect(one.status).toBe(200);
    expect(JSON.parse(await one.text())).toEqual({ a: 1 });
    const two = await t("u", init);
    expect(two.status).toBe(529);
    expect(JSON.parse(await two.text())).toEqual({ b: [2] });
    expect(t.served()).toBe(2);
  });

  it("throws naming the request number when the recordings run out", async () => {
    const t = recordingTransport([{ response: { status: 200, body: {} } }]);
    await t("u", {} as never);
    await expect(t("u", {} as never)).rejects.toThrow("recording exhausted at request 2");
    expect(t.served()).toBe(1);
  });
});

describe("toRecording", () => {
  it("maps a first-pass and a clarification-pass turn to the beta shape and drops the rest", () => {
    const ids = new Map<string, string>();
    const a = toRecording(turn(1, "first-pass", reply("msg_realA1", "toolu_realA1")), { utterance: "Put it first." }, ids);
    const b = toRecording(turn(2, "clarification-pass", reply("msg_realB2", "toolu_realB2")), { utterance: "Flag it.", answer: "A badge." }, ids);
    expect(a).toEqual({ synthetic: true, captured: true, utterance: "Put it first.", role: "first-pass", response: { status: 200, body: reply("msg_synthetic_beta_01", "toolu_synthetic_beta_01_1") } });
    expect(b.answer).toBe("A badge.");
    expect(b.role).toBe("clarification-pass");
    expect(Object.keys(a).sort()).toEqual(["captured", "response", "role", "synthetic", "utterance"]);
  });

  it("rewrites ids consistently across a set and leaves none outside the synthetic pattern", () => {
    const ids = new Map<string, string>();
    const first = reply("msg_realA1", "toolu_realA1");
    const second = { ...reply("msg_realB2", "toolu_realB2"), note: "refers to toolu_realA1" };
    const out = [
      toRecording(turn(1, "first-pass", first), { utterance: "u1" }, ids),
      toRecording(turn(2, "first-pass", second), { utterance: "u2" }, ids),
    ];
    const text = JSON.stringify(out);
    expect(text).toContain("refers to toolu_synthetic_beta_01_1");
    expect((text.match(/\b(msg|toolu)_[A-Za-z0-9_]+/g) ?? []).every((id) => /_synthetic_beta_/.test(id))).toBe(true);
    expect(text).not.toMatch(/real[AB]/);
  });

  it("throws on a fallback, an error, an omitted body and a missing body", () => {
    const say = { utterance: "u" };
    expect(() => toRecording(turn(1, "fallback", undefined, { response: undefined }), say)).toThrow(/fallback/);
    expect(() => toRecording(turn(1, "first-pass", undefined, { response: undefined, error: "timeout" }), say)).toThrow(/failed/);
    expect(() => toRecording(turn(1, "first-pass", undefined, { response: undefined, omitted: { reason: "too large", bytes: 9 } }), say)).toThrow(/omitted/);
    expect(() => toRecording(turn(1, "first-pass", undefined, { response: { status: 200 } }), say)).toThrow(/no response body/);
  });
});

describe("withFakeGh", () => {
  it("answers auth, labels and issue create, and delegates the rest", async () => {
    const seen: string[] = [];
    const gh = withFakeGh(async (cmd, args) => { seen.push(`${cmd} ${args.join(" ")}`); return { code: 7, stdout: "", stderr: "" }; }, "example/muslin");
    expect((await gh("gh", ["auth", "status"])).code).toBe(0);
    expect((await gh("gh", ["label", "list"])).stdout).toBe("[]");
    expect((await gh("gh", ["label", "create", "x"])).code).toBe(0);
    expect((await gh("gh", ["issue", "create", "--repo", "example/muslin"])).stdout.trim()).toBe("https://github.com/example/muslin/issues/1");
    expect(seen).toEqual([]);
    expect((await gh("git", ["status"])).code).toBe(7);
    expect(seen).toEqual(["git status"]);
  });
});

describe.skipIf(standalone)("filesAtCommits", () => {
  it("returns each commit's message oldest first with the file text at that commit", async () => {
    const { createFakeRunner } = await import("@fitting-room/agent/testing");
    const { filesAtCommits } = await import("./test-support/branch-files");
    const root = await temp.make("fit-ts-");
    try {
      await writeFile(join(root, "a.txt"), "one");
      const fake = await createFakeRunner(root);
      await writeFile(join(root, "a.txt"), "two");
      await fake.commitOnBase({ "a.txt": "two" });
      const log = filesAtCommits(fake, "main", ["a.txt", "gone.txt"]);
      expect(log.map((c) => c.files)).toEqual([{ "a.txt": "one" }, { "a.txt": "two" }]);
      expect(log.map((c) => c.message)).toHaveLength(2);
    } finally {
      await temp.cleanup();
    }
  });
});

describe("replayScript", () => {
  const brief = (utterance: string, otherSummary = "SYN other") => `Fitting Room live edit.\nUtterance: ${utterance}\nSummary: ${otherSummary}\nLive changes already on screen:\n- pin-9: ${otherSummary}\n`;
  const session = (pins: unknown[]): Fitting => ({ id: "fit-0b7e5a17", pins } as unknown as Fitting);
  const say = [{ text: "SYN make it sortable" }, { text: "SYN flag backorders" }, { text: "SYN do nothing" }];
  const pins = (paths: string[]) => [
    { id: "pin-1", utterance: "SYN make it sortable", liveEdit: { status: "kept", paths, ms: 1 } },
    { id: "pin-2", utterance: "SYN flag backorders", liveEdit: { status: "not-kept", reason: "question", question: "Which badge colour?", ms: 1 } },
    { id: "pin-3", utterance: "SYN do nothing", liveEdit: { status: "not-kept", reason: "no-change", ms: 1 } },
  ];
  const root = async (files: Record<string, string>) => {
    const dir = await temp.make("fit-replay-script-");
    for (const [rel, text] of Object.entries(files)) {
      await mkdir(join(dir, rel, ".."), { recursive: true });
      await writeFile(join(dir, rel), text);
    }
    return dir;
  };

  it("kept: appends the comment form for each extension, mapping the export's paths into the harness", async () => {
    const files = { "examples/sample-app/a.tsx": "A\n", "examples/sample-app/b.css": "B\n", "examples/sample-app/c.html": "C\n", "examples/sample-app/d.mjs": "D\n" };
    const dir = await root(files);
    try {
      const run = replayScript(session(pins(["a.tsx", "b.css", "examples/sample-app/c.html", "d.mjs"])), say).delegate(brief("SYN make it sortable"));
      expect(await run({ cwd: dir, input: "" })).toMatchObject({ code: 0 });
      const read = (f: string) => readFile(join(dir, "examples/sample-app", f), "utf8");
      expect(await read("a.tsx")).toBe("A\n// SYN replayed live edit\n");
      expect(await read("b.css")).toBe("B\n/* SYN replayed live edit */\n");
      expect(await read("c.html")).toBe("C\n<!-- SYN replayed live edit -->\n");
      expect(await read("d.mjs")).toBe("D\n// SYN replayed live edit\n");
    } finally {
      await temp.cleanup();
    }
  });

  it("question and no-change answer as recorded, matched on the pin's own Utterance line", async () => {
    const script = replayScript(session(pins(["a.tsx"])), say).delegate;
    // The brief for pin-2 also names "SYN make it sortable" in another field; only the Utterance line decides.
    expect(await script(brief("SYN flag backorders", "SYN make it sortable"))({ cwd: "/none", input: "" })).toEqual({ code: 0, stdout: "QUESTION: Which badge colour?" });
    expect(await script(brief("SYN do nothing"))({ cwd: "/none", input: "" })).toEqual({ code: 0, stdout: "SYN nothing to change" });
  });

  it("throws on a .json path, a brief matching no pin, and an unreplayable reason", () => {
    expect(() => replayScript(session(pins(["x.json"])), say).delegate(brief("SYN make it sortable"))).toThrow("no comment form for examples/sample-app/x.json");
    const script = replayScript(session(pins(["a.tsx"])), say).delegate;
    expect(() => script(brief("SYN something else"))).toThrow(/no recorded pin/);
    expect(() => script("Fitting Room live edit.\nSummary: SYN make it sortable\n")).toThrow(/no Utterance line/);
    const bad = [{ id: "pin-1", utterance: "SYN make it sortable", liveEdit: { status: "not-kept", reason: "timeout", ms: 1 } }];
    expect(() => replayScript(session(bad), say).delegate(brief("SYN make it sortable"))).toThrow(/pin-1 was recorded not-kept \(timeout\)/);
    const changed = [{ id: "pin-1", utterance: "SYN make it sortable", liveEdit: { status: "not-kept", reason: "check-failed", detail: "the check changed SYN file", ms: 1 } }];
    expect(() => replayScript(session(changed), say).delegate(brief("SYN make it sortable"))).toThrow(/pin-1 was recorded not-kept \(check-failed\)/);
  });

  it("check-failed: edits one write-set file and arms the check to print the recorded detail once", async () => {
    const table = "examples/sample-app/src/features/jobs/JobsTable.tsx";
    const dir = await root({ [table]: "T\n" });
    try {
      const detail = "SYN failing test line one\nSYN failing test line two";
      const recorded = [{ id: "pin-1", utterance: "SYN make it sortable", liveEdit: { status: "not-kept", reason: "check-failed", detail, ms: 1 } }];
      const { delegate, check } = replayScript(session(recorded), say);
      expect(await check({ cwd: dir, input: "" })).toEqual({ code: 0, stdout: "SYN check passed" }); // not armed before the delegate runs
      expect(await delegate(brief("SYN make it sortable"))({ cwd: dir, input: "" })).toMatchObject({ code: 0 });
      expect(await readFile(join(dir, table), "utf8")).toBe("T\n// SYN replayed live edit\n");
      expect(await check({ cwd: dir, input: "" })).toEqual({ code: 1, stdout: detail });
      expect(await check({ cwd: dir, input: "" })).toMatchObject({ code: 0 }); // one-shot
    } finally {
      await temp.cleanup();
    }
  });
});
