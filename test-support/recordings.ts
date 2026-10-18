import type { TurnRecord } from "@fitting-room/agent";

/** One captured model reply plus what the stakeholder said to draw it (D2). The agent rebuilds the prompt, so only `response` feeds a replay. */
export interface BetaRecording {
  synthetic: true;
  captured: true;
  utterance: string;
  answer?: string;
  role: "first-pass" | "clarification-pass" | "retry";
  response: { status: number; body: unknown };
}

const ID = /\b(msg|toolu)_[A-Za-z0-9_]+/g;
const SYNTHETIC = /^(msg|toolu)_synthetic_/;

const pad = (n: number): string => String(n).padStart(2, "0");

function mapIds(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") return value.replace(ID, (id) => ids.get(id) ?? id);
  if (Array.isArray(value)) return value.map((v) => mapIds(v, ids));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapIds(v, ids)]));
  return value;
}

/**
 * A real turn file to a committable recording. Real API ids are account-linked, so the reply's
 * `msg_` id and each `tool_use` id become `msg_synthetic_beta_NN` and `toolu_synthetic_beta_NN_k`.
 * Pass the same `ids` map for every turn of one set so a repeated id gets one synthetic value.
 * Throws on a turn that cannot be replayed (fallback, error, omitted, no body) and on any id left unmapped.
 */
export function toRecording(turn: TurnRecord, said: { utterance: string; answer?: string }, ids: Map<string, string> = new Map()): BetaRecording {
  if (turn.role === "fallback") throw new Error(`turn ${turn.n}: a rule fallback is not a recording`);
  if (turn.error !== undefined) throw new Error(`turn ${turn.n}: the call failed (${turn.error})`);
  if (turn.omitted) throw new Error(`turn ${turn.n}: the body was omitted (${turn.omitted.reason})`);
  if (turn.response?.body === undefined) throw new Error(`turn ${turn.n}: no response body`);
  const nn = pad(turn.n);
  const body = turn.response.body as { id?: unknown; content?: unknown };
  if (typeof body.id === "string" && !ids.has(body.id)) ids.set(body.id, `msg_synthetic_beta_${nn}`);
  if (Array.isArray(body.content)) {
    body.content.forEach((block: { type?: unknown; id?: unknown }, k) => {
      if (block?.type === "tool_use" && typeof block.id === "string" && !ids.has(block.id)) ids.set(block.id, `toolu_synthetic_beta_${nn}_${k}`);
    });
  }
  const mapped = mapIds(turn.response.body, ids);
  const left = (JSON.stringify(mapped).match(ID) ?? []).filter((id) => !SYNTHETIC.test(id));
  if (left.length > 0) throw new Error(`turn ${turn.n}: ${left.length} API id(s) left unmapped`);
  return {
    synthetic: true,
    captured: true,
    utterance: said.utterance,
    ...(said.answer !== undefined ? { answer: said.answer } : {}),
    role: turn.role,
    response: { status: turn.response.status, body: mapped },
  };
}
