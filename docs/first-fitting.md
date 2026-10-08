# Your first fitting

A fitting is a stakeholder trying on the real screen before anything is built (see the [glossary](glossary.md)). This walkthrough runs one on the sample app, end to end, with the facilitator agent. No model is configured and nothing touches the network until the last, manual step. `examples/sample-app/replay.test.ts` replays every `fit` and `json muslin-edit` fenced block below, so this doc cannot drift from the code.

## Setup

```sh
npm ci && npm run build          # from the repo root; builds packages/cli/dist
cd examples/sample-app
alias fit="node ../../packages/cli/dist/index.js"
npm run dev:muslin               # optional, in a second terminal: watch the muslin change as you pin
```

`.fitting-room/config.json` is already committed. It points `fit` at `src/features/jobs/tableConfig.json` (the config surface) and `tableConfig.muslin.json` (the muslin-only overlay).

## 1. Start the fitting

```fit
fit fitting start --allow-self-host --role "dispatch supervisor" --screen "Jobs worklist" --fixture SYN-JOB-4120 --fixture SYN-JOB-4121
```

`--allow-self-host` is needed only because this walkthrough runs inside the Fitting Room monorepo; in a real host, or the standalone sample-app repo (`node scripts/export-sample-app.mjs`), leave it off.

```sh
FITTING=$(ls -t .fitting-room/sessions/fit-*.json | head -1)
```

`fitting start` snapshotted the config surface as the baseline every `--patch` diffs against.

## 2. Pin a layout change

The stakeholder says what they want. The facilitator moves the column live (hot reload shows it), then pins it.

```json muslin-edit src/features/jobs/tableConfig.json
{ "columnOrder": ["reference", "status", "technician", "priority", "customerName", "openedYear", "slaHoursRemaining"] }
```

In your copy, make the same edit to `columnOrder` by hand. Then record the pin:

```fit
fit pin "$FITTING" "Put the technician right after the status, that's who I look for first." --summary "Technician column moved next to Status" --patch columnOrder
```

## 3. Pin a display rule

The muslin can only flag negative values today, so this pin records the ask honestly with no config patch. The ticket's acceptance criterion says the rule must be configurable.

```fit
fit pin "$FITTING" "Flag any job with a part on backorder so I can chase it." --summary "Jobs with a backordered part are flagged in the worklist"
```

## 4. Pin a data gap

The sample data has no warranty field. The facilitator classifies the request as `data-gap` with scope `backend` and `impliedField: warrantyStatus`. The striped "not in data today" column in the muslin is that same field from `tableConfig.muslin.json`. It is never added to `tableConfig.json`.

```fit
fit pin "$FITTING" "Add a warranty status column" --summary "Warranty status column (not in data today)"
```

## 5. Attempt

Triage is empirical. The facilitator applies the two frontend pins and stops on the data gap with a question routed to the backend lead.

```fit
fit attempt "$FITTING"
```

## 6. Submit

This prints the alterations ticket: the verbatim words, the config diff with `before` values, three acceptance criteria, the data gap flagged `backend`, and `## Triage`.

```fit
fit submit "$FITTING"
```

## 7. Publish (manual, real GitHub)

This needs `gh` installed and `gh auth login`. It creates a real issue, so it is the one step the replay never runs.

```sh
fit submit "$FITTING" --publish github --repo <you>/<your-scratch-repo>
```

The issue URL is recorded as `ticket` in the session; republishing is refused.

## Clean up

```sh
git restore src/features/jobs/tableConfig.json src/features/jobs/tableConfig.muslin.json
```

The walkthrough edited the real config surface in your working copy, and the data-gap pin rewrote the muslin overlay (same entry, `fit`'s JSON formatting). The pins are the record, so restore both files.
