export type Fields = Record<string, unknown>;
export interface Prepared {
  site: "youtube" | "bilibili" | "baidupan";
  mode: string;
  record: { dedupeKey: string; fields: Fields };
  parent?: { dedupeKey: string; fields: Fields };
}
export interface FieldRule {
  name: string;
  type: "text" | "number" | "list" | "date";
  enabled: boolean;
  refresh: boolean;
  records: "all" | "video" | "playlist";
}
export interface BridgeSettings {
  recordOpenMode: "window" | "tab";
  vaultId?: string;
  root: string;
  videos: string;
  playlists: string;
  fields: Record<string, FieldRule>;
}
export const defaults: BridgeSettings = {
  recordOpenMode: "window",
  root: "TSNotes",
  videos: "Videos",
  playlists: "Playlists",
  fields: {},
};
export const registry: Record<string, FieldRule> = {
  title: {
    name: "Title",
    type: "text",
    enabled: true,
    refresh: true,
    records: "all",
  },
  channel: {
    name: "Creator",
    type: "text",
    enabled: true,
    refresh: true,
    records: "all",
  },
  durationText: {
    name: "Duration",
    type: "text",
    enabled: true,
    refresh: true,
    records: "video",
  },
  durationSec: {
    name: "Duration Seconds",
    type: "number",
    enabled: true,
    refresh: true,
    records: "video",
  },
  coverUrl: {
    name: "Cover URL",
    type: "text",
    enabled: true,
    refresh: true,
    records: "all",
  },
  url: {
    name: "Link",
    type: "text",
    enabled: true,
    refresh: true,
    records: "video",
  },
  urlTsnotes: {
    name: "URL-TSNotes",
    type: "text",
    enabled: true,
    refresh: true,
    records: "all",
  },
  playlistUrl: {
    name: "Link",
    type: "text",
    enabled: true,
    refresh: true,
    records: "playlist",
  },
  channelId: {
    name: "Creator ID",
    type: "text",
    enabled: false,
    refresh: true,
    records: "all",
  },
  channelUrl: {
    name: "Creator URL",
    type: "text",
    enabled: false,
    refresh: true,
    records: "all",
  },
  originalUrl: {
    name: "Original URL",
    type: "text",
    enabled: false,
    refresh: true,
    records: "video",
  },
  publishDate: {
    name: "Published",
    type: "date",
    enabled: false,
    refresh: true,
    records: "video",
  },
  uploadDate: {
    name: "Uploaded",
    type: "date",
    enabled: false,
    refresh: true,
    records: "video",
  },
  category: {
    name: "Source Category",
    type: "text",
    enabled: false,
    refresh: true,
    records: "video",
  },
  viewCountRaw: {
    name: "Views",
    type: "number",
    enabled: false,
    refresh: true,
    records: "video",
  },
};
export function safePath(raw: string): string {
  const p = raw.replace(/\\/g, "/").replace(/\/$/, "");
  if (
    !p ||
    p.startsWith("/") ||
    p
      .split("/")
      .some((x) => !x || x === "." || x === ".." || x.startsWith(".")) ||
    /[:\x00-\x1f]/.test(p)
  )
    throw Error("invalid_relative_directory");
  return p;
}
export function fileName(raw: string): string {
  return (
    raw
      .replace(/[\\/:*?"<>|#\[\]^\x00-\x1f]/g, " ")
      .replace(/[. ]+$/, "")
      .trim()
      .slice(0, 100) || "Untitled"
  );
}
export function text(v: unknown): string {
  return v == null ? "" : String(v).trim();
}
export function identities(p: Prepared): string[] {
  const f = p.record.fields;
  const site = p.site;
  if (site === "youtube")
    return text(f.videoId) ? ["yt:video:" + text(f.videoId)] : [];
  if (site === "bilibili") {
    let part = "1";
    try {
      part =
        new URL(text(f.url) || text(f.originalUrl)).searchParams.get("p") ||
        "1";
    } catch {}
    if (!/^\d+$/.test(part)) throw Error("invalid_bilibili_part");
    return [
      ...(text(f.cid) ? ["bili:cid:" + text(f.cid)] : []),
      ...(text(f.videoId) ? ["bili:bv:" + text(f.videoId) + ":p:" + part] : []),
    ];
  }
  return [
    ...(text(f.fsId) ? ["bd:fs:" + text(f.fsId)] : []),
    ...(text(f.objectKey) ? ["bd:object:" + text(f.objectKey)] : []),
  ];
}
export function assertCompatible(stored: Fields, p: Prepared): void {
  if (stored.Site && stored.Site !== p.site)
    throw Error("source_identity_conflict");
  const f = p.record.fields;
  if (p.site === "bilibili" && text(stored.Part)) {
    const part = identities(p)
      .find((x) => x.startsWith("bili:bv:"))
      ?.split(":")
      .at(-1);
    if (part && part !== text(stored.Part))
      throw Error("bilibili_part_conflict");
  }
  const checks =
    p.site === "youtube"
      ? [["Video ID", "videoId"]]
      : p.site === "bilibili"
        ? [
            ["Video ID", "videoId"],
            ["CID", "cid"],
          ]
        : [
            ["File ID", "fsId"],
            ["Object Key", "objectKey"],
          ];
  for (const [prop, key] of checks)
    if (
      text(stored[prop]) &&
      text(f[key]) &&
      text(stored[prop]) !== text(f[key])
    )
      throw Error("source_identity_conflict");
}
export function technical(p: Prepared): Fields {
  const f = p.record.fields;
  const out: Fields = { "Source Identities": identities(p) };
  const mapping: Record<string, string> = {
    videoId: "Video ID",
    cid: "CID",
    aid: "AID",
    fsId: "File ID",
    objectKey: "Object Key",
    fileMd5: "File MD5",
    filePath: "File Path",
    parentPath: "Parent Path",
  };
  for (const [key, name] of Object.entries(mapping))
    if (text(f[key])) out[name] = text(f[key]);
  if (p.site === "bilibili") {
    const id = identities(p).find((x) => x.startsWith("bili:bv:"));
    if (id) out.Part = id.split(":").at(-1);
  }
  return out;
}
const reserved = new Set([
  "TSNotesID",
  "Record Type",
  "Site",
  "DedupeKey",
  "DedupeURL",
  "DedupeAliases",
  "Source Identities",
  "Created time",
  "Video ID",
  "CID",
  "AID",
  "Part",
  "File ID",
  "Object Key",
  "File MD5",
  "File Path",
  "Parent Path",
  "Playlists",
  "Playlist IDs",
  "Playlist ID",
  "Videos",
  "Total Videos",
  "Relations Path",
  "Source Total Videos",
]);
export function mapped(
  f: Fields,
  settings: BridgeSettings,
  kind: "video" | "playlist",
  refresh = false,
): Fields {
  const result: Fields = {},
    names = new Set<string>();
  for (const [key, base] of Object.entries(registry)) {
    const rule = { ...base, ...settings.fields[key] };
    if (
      !rule.enabled ||
      (refresh && !rule.refresh) ||
      (rule.records !== "all" && rule.records !== kind)
    )
      continue;
    if (
      !rule.name.trim() ||
      reserved.has(rule.name) ||
      rule.name === "__proto__" ||
      rule.name === "constructor"
    )
      throw Error("reserved_property_name");
    if (names.has(rule.name)) throw Error("duplicate_property_mapping");
    names.add(rule.name);
    const value = f[key];
    if (value == null || value === "") continue;
    if (rule.type === "number") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) result[rule.name] = n;
    } else if (rule.type === "list") {
      const a = Array.isArray(value)
        ? value.map(text).filter(Boolean)
        : [text(value)];
      if (a.length) result[rule.name] = a;
    } else if (rule.type === "date") {
      const s = text(value);
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) result[rule.name] = s;
    } else result[rule.name] = text(value);
  }
  return result;
}
export function validatePrepared(value: unknown): Prepared {
  if (!value || typeof value !== "object") throw Error("invalid_video_record");
  const p = value as Prepared;
  if (
    !["youtube", "bilibili", "baidupan"].includes(p.site) ||
    !p.record ||
    !text(p.record.dedupeKey) ||
    !p.record.fields ||
    typeof p.record.fields !== "object" ||
    !["normal_video", "playlist_video", "pan_video"].includes(p.mode)
  )
    throw Error("invalid_video_record");
  for (const record of [p.record, p.parent].filter(Boolean))
    if (text(record!.dedupeKey).length > 1000 || !text(record!.fields.title))
      throw Error("invalid_video_record");
  return p;
}
