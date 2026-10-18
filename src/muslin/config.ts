/**
 * Purpose: the merged muslin config: the base table config with the muslin-only overlay on top.
 * Responsibilities: build `muslinConfig`. No side effects, so tests import it freely.
 * Inputs: none. Outputs: muslinConfig.
 * Dependencies: both config JSONs, ../api/types (types only).
 * Side Effects: none.
 * @invariants placeholderColumns exist only here, never in tableConfig.json.
 * Live edit never writes this file: it is part of the muslin seam, listed in liveEdit.protect (.fitting-room/config.json).
 */
import baseConfig from "../features/jobs/tableConfig.json";
import overlay from "../features/jobs/tableConfig.muslin.json";
import type { TableConfig } from "../api/types";

export const muslinConfig: TableConfig = {
  ...(baseConfig as TableConfig),
  ...overlay,
};
