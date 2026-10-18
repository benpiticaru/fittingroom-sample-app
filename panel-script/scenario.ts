/**
 * The scripted fitting behind the panel's acceptance fixture (FR-14).
 *
 * Purpose: data only. The B7 acceptance script (spec line 306) through the
 * withdrawal, plus the undressed, withdraw-conflict and dirty-branch cases.
 * Inputs: none. Outputs: SCENARIO, consumed by generate.ts.
 * Every string here is synthetic.
 */
export type ScenarioStep =
  | { kind: "send"; route: string; text: string; ask?: string; dirty?: true }
  | { kind: "withdraw"; pinId: string };

export const SCENARIO = {
  fittingId: "fit-0a1b2c3d",
  token: "synthetic-token-0001",
  configSurface: "src/features/jobs/tableConfig.json",
  persona: "dispatcher",
  bundleKeys: ["jobs"],
  screens: { "/jobs": { endpoints: ["jobs"] } },
  meta: { agent: "git", modelBacked: false, remote: null, personas: ["dispatcher"], personasDir: "src/fixtures/personas", screens: ["/jobs"], publisher: { name: "none" as const, target: null },
    personaInfo: { dispatcher: { displayName: "Synthetic Dispatcher", handle: "SYN-USER-dispatch", records: [{ key: "jobs", count: 4 }] } } },
  start: { role: "dispatcher", screen: "/jobs", fixtures: [] as string[] },
  steps: [
    { kind: "send", route: "/jobs", text: "Put the technician right after the status, that's who I look for first." },
    {
      kind: "send",
      route: "/jobs",
      text: "Flag any job with a part on backorder so I can chase it.",
      ask: "Should a backordered job get a badge on its row, or also move to the top?",
    },
    { kind: "send", route: "/jobs", text: "A badge on the row is enough." },
    { kind: "send", route: "/jobs", text: "Add a last visit date column" },
    { kind: "withdraw", pinId: "pin-1" },
    { kind: "send", route: "/map", text: "Add a parts on backorder column" },
    { kind: "send", route: "/jobs", text: "Sort by priority" },
    { kind: "send", route: "/jobs", text: "Sort by customer" },
    { kind: "withdraw", pinId: "pin-5" },
    { kind: "send", route: "/jobs", text: "Make it compact", dirty: true },
  ] as ScenarioStep[],
};

/** The recorded fitting's utterances (FR-17 B7), verbatim; the owner's code pin is lower case with no full stop. */
export const B7_UTTERANCES: string[] = [
  "Put the technician right after the status, that's who I look for first.",
  "Flag any job with a part on backorder so I can chase it.",
  "A badge on the row is enough.",
  "Add a last visit date column",
  "add interactive sort functionality to each column",
];
