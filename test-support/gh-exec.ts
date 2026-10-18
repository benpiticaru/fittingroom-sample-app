import type { Runner } from "@fitting-room/agent";

/** A `gh` that files the issue at `https://github.com/<repo>/issues/1`; everything else goes to `runner`. No network. */
export function withFakeGh(runner: Runner, repo: string): Runner {
  return async (cmd, args, opts) => {
    if (cmd !== "gh") return runner(cmd, args, opts);
    const [a, b] = args;
    if (a === "auth" && b === "status") return { code: 0, stdout: "", stderr: "" };
    if (a === "label" && b === "list") return { code: 0, stdout: "[]", stderr: "" };
    if (a === "label" && b === "create") return { code: 0, stdout: "", stderr: "" };
    if (a === "issue" && b === "create") return { code: 0, stdout: `https://github.com/${repo}/issues/1\n`, stderr: "" };
    return runner(cmd, args, opts);
  };
}
