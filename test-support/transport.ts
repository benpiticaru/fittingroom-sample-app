import type { ModelTransport } from "@fitting-room/agent";
import type { BetaRecording } from "./recordings.js";

/** Serves the recordings in order, one per request; the request after the last throws. Never touches the network. */
export function recordingTransport(responses: Array<Pick<BetaRecording, "response">>): ModelTransport & { served(): number } {
  let n = 0;
  const t = (async () => {
    const r = responses[n];
    n += 1;
    if (!r) throw new Error(`recording exhausted at request ${n}`);
    return { status: r.response.status, text: async () => JSON.stringify(r.response.body) };
  }) as ModelTransport & { served(): number };
  t.served = () => Math.min(n, responses.length);
  return t;
}
