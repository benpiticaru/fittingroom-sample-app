import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

/** A repo-level file (docs/…, schema/…): the standalone export carries a copy beside the app; the monorepo has it two levels up. */
export function repoFile(rel: string): string {
  const local = join(appDir, rel);
  return existsSync(local) ? local : join(appDir, "..", "..", rel);
}
