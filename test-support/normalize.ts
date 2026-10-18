import type { Fitting, Pin } from "@fitting-room/core";

export const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
/** The harness hosts the app at `examples/sample-app/`; the export's host is the repo root. */
const HOST_PREFIX = "examples/sample-app/";

const unprefix = (p: string): string => (p.startsWith(HOST_PREFIX) ? p.slice(HOST_PREFIX.length) : p);

function liveEdit(p: Pin): Pin {
  const le = p.liveEdit;
  if (!le) return p;
  return {
    ...p,
    liveEdit: {
      ...le,
      ...(le.commit !== undefined ? { commit: "<sha>" } : {}),
      ...(le.revertCommit !== undefined ? { revertCommit: "<sha>" } : {}),
      ...(le.paths !== undefined ? { paths: le.paths.map(unprefix) } : {}),
      ms: "<ms>" as unknown as number,
    },
  };
}

/**
 * Strip what legitimately differs between runs: the fitting id (incl. attempt.branch), timestamps, build id, and the
 * live-edit fields (commit shas, duration, the harness's `examples/sample-app/` path prefix). A session with no
 * `liveEdit` and no attempt files normalises exactly as before.
 */
export function normalize(f: Fitting): unknown {
  const s = JSON.stringify(f).split(f.id).join("<fitting-id>").replace(ISO, "<time>");
  const out = JSON.parse(s) as Fitting;
  const attempt = out.attempt && "filesChanged" in out.attempt ? { ...out.attempt, filesChanged: out.attempt.filesChanged.map(unprefix) } : out.attempt;
  return { ...out, pins: out.pins.map(liveEdit), ...(attempt ? { attempt } : {}), muslinBuild: "<build>" };
}
