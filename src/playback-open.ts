/** Temporary navigation context, never an authorization credential. */
export interface PlaybackOpen { v: 2; operationId: string; vaultId: string; expectedClientId?: string }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const transport = new Set(["__tsnotes_open", "__tsnotes_vault", "__tsnotes_ticket"]);
function parameter(pair: string): string { try { return decodeURIComponent(pair.split("=", 1)[0]); } catch { return ""; } }
export function stripPlaybackTransport(raw: string): string {
  const at = raw.indexOf("#"), head = at < 0 ? raw : raw.slice(0, at), fragment = at < 0 ? "" : raw.slice(at), q = head.indexOf("?");
  if (q < 0) return raw;
  const kept = head.slice(q + 1).split("&").filter(p => !transport.has(parameter(p)));
  return head.slice(0, q) + (kept.length ? "?" + kept.join("&") : "") + fragment;
}
export function playbackOpen(raw: string): PlaybackOpen | null {
  try {
    const values = new URL(raw).searchParams.getAll("__tsnotes_open");
    if (values.length !== 1 || values[0].length > 1024 || !/^[A-Za-z0-9_-]+$/.test(values[0])) return null;
    const p = JSON.parse(atob(values[0].replace(/-/g, "+").replace(/_/g, "/"))) as PlaybackOpen;
    return p.v === 2 && uuid.test(p.operationId) && uuid.test(p.vaultId) && (!p.expectedClientId || uuid.test(p.expectedClientId)) ? p : null;
  } catch { return null; }
}
export function addPlaybackOpen(raw: string, context: PlaybackOpen): string {
  if (!uuid.test(context.operationId) || !uuid.test(context.vaultId) || context.expectedClientId && !uuid.test(context.expectedClientId)) throw Error("invalid_playback_context");
  const clean = stripPlaybackTransport(raw), hash = clean.indexOf("#"), head = hash < 0 ? clean : clean.slice(0, hash), fragment = hash < 0 ? "" : clean.slice(hash);
  const data = btoa(JSON.stringify({ v: 2, operationId: context.operationId, vaultId: context.vaultId, ...(context.expectedClientId ? {expectedClientId: context.expectedClientId} : {}) })).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  return head + (head.includes("?") ? "&" : "?") + "__tsnotes_open=" + data + fragment;
}
