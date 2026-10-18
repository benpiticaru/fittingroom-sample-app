import type { FakeRunner } from "@fitting-room/agent/testing";

/** Each commit on `branch` since main, oldest first, with the text of `paths` (repo-relative) as that commit holds them. */
export function filesAtCommits(fake: FakeRunner, branch: string, paths: string[]): Array<{ message: string; files: Record<string, string> }> {
  return fake.commitLog(branch).map((c) => ({ message: c.message, files: c.files(paths) }));
}
