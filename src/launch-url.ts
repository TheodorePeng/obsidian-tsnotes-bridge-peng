/** Transport markers are temporary. Never reserialize the business query. */
const names = new Set(["__tsnotes_vault", "__tsnotes_ticket"]);
function supported(raw: string): void {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    ![
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "m.youtube.com",
      "m.bilibili.com",
      "bilibili.com",
      "www.bilibili.com",
      "pan.baidu.com",
    ].includes(url.hostname)
  )
    throw new Error("unsupported_launch_url");
}
function parts(raw: string) {
  const hash = raw.indexOf("#");
  const head = hash < 0 ? raw : raw.slice(0, hash);
  const fragment = hash < 0 ? "" : raw.slice(hash);
  const q = head.indexOf("?");
  return {
    base: q < 0 ? head : head.slice(0, q),
    query: q < 0 ? [] : head.slice(q + 1).split("&"),
    fragment,
  };
}
function name(pair: string): string {
  try {
    return decodeURIComponent(pair.split("=", 1)[0]);
  } catch {
    return pair.split("=", 1)[0];
  }
}
export function hasLaunchMarker(raw: string): boolean {
  return parts(raw).query.some((pair) => names.has(name(pair)));
}
export function readLaunchMarker(
  raw: string,
): { originalUrl: string; vaultId: string; ticket: string } | null {
  const p = parts(raw),
    marked = p.query.filter((pair) => names.has(name(pair)));
  if (!marked.length) return null;
  supported(raw);
  const u = new URL(raw),
    vaults = u.searchParams.getAll("__tsnotes_vault"),
    tickets = u.searchParams.getAll("__tsnotes_ticket");
  if (
    marked.length !== 2 ||
    vaults.length !== 1 ||
    tickets.length !== 1 ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(vaults[0]) ||
    !/^[a-f0-9]{64}$/.test(tickets[0])
  )
    throw new Error("invalid_launch_marker");
  const query = p.query.filter((pair) => !names.has(name(pair))).join("&");
  return {
    originalUrl: p.base + (query ? "?" + query : "") + p.fragment,
    vaultId: vaults[0],
    ticket: tickets[0],
  };
}
export function addLaunchMarker(
  raw: string,
  vaultId: string,
  ticket: string,
): string {
  supported(raw);
  if (
    hasLaunchMarker(raw) ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(vaultId) ||
    !/^[a-f0-9]{64}$/.test(ticket)
  )
    throw new Error("invalid_launch_marker");
  const p = parts(raw),
    head = p.base + (p.query.length ? "?" + p.query.join("&") : "");
  return (
    head +
    (p.query.length ? "&" : "?") +
    "__tsnotes_vault=" +
    vaultId +
    "&__tsnotes_ticket=" +
    ticket +
    p.fragment
  );
}
