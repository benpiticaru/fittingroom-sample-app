import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DelegateScript } from "@fitting-room/agent/testing";
import type { Fitting, Pin } from "@fitting-room/core";

const HOST_REL = "examples/sample-app";
const UTTERANCE_LINE = "Utterance: ";
const COMMENT_TEXT = "SYN replayed live edit";
/** A write-set file the live runs already edit; a not-kept record has no `paths`, so a check-failed replay edits this one. */
const CHECK_FAILED_FILE = `${HOST_REL}/src/features/jobs/JobsTable.tsx`;
/** The refusal form of check-failed (`transaction.ts`): its detail derives from the real agent's diff, which a replay cannot reproduce. */
const CHANGED_CHECK = "the check changed ";

/** The comment form by extension; any other extension (JSON included) would corrupt the file, so it throws. */
function commentFor(path: string): string {
  if (/\.(ts|tsx|js|jsx|mjs)$/.test(path)) return `// ${COMMENT_TEXT}`;
  if (/\.css$/.test(path)) return `/* ${COMMENT_TEXT} */`;
  if (/\.html$/.test(path)) return `<!-- ${COMMENT_TEXT} -->`;
  throw new Error(`no comment form for ${path}`);
}

/** The recorded paths are relative to the recording's host (the export's root); the harness hosts the app one level down. */
const inHarness = (p: string): string => (p.startsWith(`${HOST_REL}/`) ? p : `${HOST_REL}/${p}`);

/**
 * The scripted coding agent and check for the `claude` replay: for each live-edit brief, the verdict the committed session
 * recorded for that pin. The brief is matched on its own `Utterance:` line (the brief's field for the pin, never a
 * substring of the whole brief, where another pin's summary could appear), against the pins of the recorded script.
 * `kept` appends one synthetic comment line to each recorded path (so the kept paths match while no real agent output
 * enters the repo); `not-kept`/`question` answers `QUESTION: <recorded question>`; `not-kept`/`no-change` changes nothing;
 * `not-kept`/`check-failed` appends the comment line to one write-set file and arms the one-shot `check`, which then exits 1
 * printing the recorded `detail` (the live runner's check gets no brief, so the delegate arms it; live edits run one at a
 * time, spec 433, so the armed pin is the running one) and exits 0 every other time, as does the attempt's `testCommand`.
 * Anything else, a check-failed whose detail starts "the check changed ", a brief matching no pin and a pin with no live
 * edit throw.
 */
export function replayScript(session: Fitting, utterances: ReadonlyArray<{ text: string }>): { delegate: (input: string) => DelegateScript; check: DelegateScript } {
  const texts = new Set(utterances.map((u) => u.text));
  const pins = session.pins.filter((p) => texts.has(p.utterance));
  let armed: string | undefined;
  const check: DelegateScript = async () => {
    if (armed === undefined) return { code: 0, stdout: "SYN check passed" };
    const detail = armed;
    armed = undefined;
    return { code: 1, stdout: detail };
  };
  const delegate = (input: string): DelegateScript => {
    const line = input.split("\n").find((l) => l.startsWith(UTTERANCE_LINE));
    if (line === undefined) throw new Error("replayScript: the brief has no Utterance line");
    const said = line.slice(UTTERANCE_LINE.length);
    const pin: Pin | undefined = pins.find((p) => p.utterance.split("\n")[0] === said);
    if (!pin) throw new Error(`replayScript: no recorded pin for the brief's utterance`);
    const le = pin.liveEdit;
    if (!le) throw new Error(`replayScript: ${pin.id} has no recorded live edit`);
    const append = (paths: string[]): DelegateScript => {
      paths.forEach(commentFor); // throws before any write when one path has no comment form
      return async ({ cwd }) => {
        for (const p of paths) {
          const abs = join(cwd, p);
          await readFile(abs, "utf8"); // the recorded path must exist in the harness
          await appendFile(abs, `${commentFor(p)}\n`);
        }
        return { code: 0, stdout: "SYN edit replayed" };
      };
    };
    if (le.status === "kept") return append((le.paths ?? []).map(inHarness));
    if (le.status === "not-kept" && le.reason === "question") return async () => ({ code: 0, stdout: `QUESTION: ${le.question ?? ""}` });
    if (le.status === "not-kept" && le.reason === "no-change") return async () => ({ code: 0, stdout: "SYN nothing to change" });
    if (le.status === "not-kept" && le.reason === "check-failed" && le.detail !== undefined && !le.detail.startsWith(CHANGED_CHECK)) {
      const edit = append([CHECK_FAILED_FILE]);
      const detail = le.detail;
      return async (o) => {
        const r = await edit(o);
        armed = detail;
        return r;
      };
    }
    throw new Error(`replayScript: ${pin.id} was recorded ${le.status}${le.reason ? ` (${le.reason})` : ""}, which cannot be replayed`);
  };
  return { delegate, check };
}
