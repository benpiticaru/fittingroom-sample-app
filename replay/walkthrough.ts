/**
 * Test support for the walkthrough replay: turns docs/first-fitting.md into steps.
 * Executable fences: ```fit (one `fit …` command per line; blank lines and `#` comments skipped)
 * and ```json muslin-edit <path> (a JSON object whose top-level keys replace the file's).
 * Every other fence is prose for the reader.
 */
export type Step =
  | { kind: "fit"; line: string }
  | { kind: "edit"; file: string; patch: Record<string, unknown> };

const FENCE = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;

export function parseWalkthrough(markdown: string): Step[] {
  const steps: Step[] = [];
  for (const m of markdown.matchAll(FENCE)) {
    const info = m[1]!.trim().split(/\s+/);
    const body = m[2]!;
    if (info[0] === "fit") {
      for (const raw of body.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (!line.startsWith("fit ")) throw new Error(`fit block line must start with "fit ": ${line}`);
        steps.push({ kind: "fit", line: line.slice(4) });
      }
    } else if (info[0] === "json" && info[1] === "muslin-edit" && info[2]) {
      const patch: unknown = JSON.parse(body);
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error(`muslin-edit ${info[2]} must be a JSON object`);
      steps.push({ kind: "edit", file: info[2], patch: patch as Record<string, unknown> });
    }
  }
  return steps;
}

/** Minimal shell-like split: whitespace, '…', "…", and $NAME expansion (bare or in double quotes) from `vars`. */
export function tokenize(line: string, vars: Record<string, string>): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let i = 0;
  const expand = (): void => {
    const name = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(line.slice(i));
    if (!name) { cur += "$"; i++; return; }
    const v = vars[name[1]!];
    if (v === undefined) throw new Error(`unbound variable $${name[1]} in: ${line}`);
    cur += v;
    i += name[0].length;
  };
  while (i < line.length) {
    const c = line[i]!;
    if (c === " " || c === "\t") {
      if (has) { out.push(cur); cur = ""; has = false; }
      i++;
    } else if (c === "'" || c === '"') {
      const end = line.indexOf(c, i + 1);
      if (end < 0) throw new Error(`unterminated quote in: ${line}`);
      has = true;
      if (c === "'") { cur += line.slice(i + 1, end); i = end + 1; continue; }
      i++;
      while (i < end) {
        if (line[i] === "$") expand();
        else cur += line[i++];
      }
      i = end + 1;
    } else if (c === "$") {
      has = true;
      expand();
    } else {
      has = true;
      cur += c;
      i++;
    }
  }
  if (has) out.push(cur);
  return out;
}
