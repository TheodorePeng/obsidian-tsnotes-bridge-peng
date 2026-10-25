import {posix} from "node:path";
import {createHash} from "node:crypto";
import {parseYaml, stringifyYaml} from "obsidian";
import {libraryPaths, durationFormula, libraryGuide} from "./library";
import {deprecatedProperties, isUUID} from "./property-rules";
import {parseDuration, formatDuration} from "./duration";
import type {BridgeSettings, Fields} from "./model";

export const contentHash = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export interface MovedFile {from: string; to: string; sha256: string; text: boolean;}
export function splitNote(raw: string): {props: Fields; body: string} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {props: {}, body: raw};
  const props = parseYaml(match[1]);
  if (!props || typeof props !== "object" || Array.isArray(props)) throw Error("invalid_frontmatter");
  return {props, body: raw.slice(match[0].length)};
}
export function upgradeRoots(settings: BridgeSettings): {from: string; to: string}[] {
  const p = libraryPaths(settings);
  return [...new Set([settings.videos, settings.playlists, "Resources", "_data"])].map(name => ({from: `${p.root}/${name}`, to: `${p.storageRoot}/${name}`}));
}
export function finalPath(path: string, settings: BridgeSettings): string {
  const root = upgradeRoots(settings).find(r => path.startsWith(r.from + "/"));
  return root ? root.to + path.slice(root.from.length) : path;
}
// Both old and new spellings resolve to the same logical file. A short name is
// accepted only when unambiguous; no fuzzy title/UUID guessing is performed.
export function resolveReference(destination: string, source: string, universe: string[], settings: BridgeSettings): string | null {
  if (/^(?:[a-z][\w+.-]*:|#|\/\/)/i.test(destination)) return null;
  let target: string; try { target = decodeURIComponent(destination.replace(/^<|>$/g, "").trim()); } catch { return null; }
  target = target.split("#")[0];
  if (!target) return null;
  const names = (path: string) => [path, ...(path.endsWith(".md") ? [path.slice(0, -3)] : [])];
  const canonicalSource = universe.find(path => path === source || finalPath(path, settings) === source) || source;
  const candidates = [posix.normalize(posix.join(posix.dirname(source), target)), posix.normalize(posix.join(posix.dirname(canonicalSource), target)), target];
  for (const candidate of candidates) {
    const found = universe.filter(path => [...names(path), ...names(finalPath(path, settings))].includes(candidate));
    if (found.length === 1) return found[0];
  }
  const found = universe.filter(path => [...names(path), ...names(finalPath(path, settings))].some(name => name === target || name.endsWith("/" + target)));
  return found.length === 1 ? found[0] : null;
}
function mapLinks(raw: string, source: string, universe: string[], settings: BridgeSettings, canonical: boolean): string {
  const change = (target: string, wiki: boolean): string => {
    const fragmentAt = target.indexOf("#"), head = fragmentAt < 0 ? target : target.slice(0, fragmentAt), fragment = fragmentAt < 0 ? "" : target.slice(fragmentAt);
    const resolved = resolveReference(head, source, universe, settings);
    if (!resolved) return target;
    if (canonical) return "@tsnotes-file:" + resolved + fragment;
    const next = finalPath(resolved, settings);
    if (next === resolved) return target;
    // Short links and relative assets remain valid after folder moves; retain
    // their spelling. Explicit old paths must follow the new destination.
    let decoded: string; try { decoded = decodeURIComponent(head.trim()); } catch { return target; }
    if (!decoded.startsWith(settings.root + "/") && !decoded.includes("../")) return target;
    return (wiki ? next.replace(/\.md$/, "") : encodeURI(next)) + fragment;
  };
  const prose = (part: string) => part.replace(/(?<!\\)\[\[([^\]\n]+)\]\]/g, (_match, inside: string) => {
    const pipe = inside.indexOf("|"), target = pipe < 0 ? inside : inside.slice(0, pipe), alias = pipe < 0 ? "" : inside.slice(pipe);
    return "[[" + change(target, true) + alias + "]]";
  }).replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)]+)(\))/g, (_match, start: string, target: string, end: string) => {
    const angled = target.startsWith("<"), value = angled ? target.slice(1, -1) : target;
    return start + (angled ? "<" : "") + change(value, false) + (angled ? ">" : "") + end;
  });
  return raw.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)/g).map((part, index) => index % 2 ? part : prose(part)).join("");
}
const sortValue = (value: unknown): unknown => Object.prototype.toString.call(value) === "[object Date]" ? (value as Date).toISOString() : Array.isArray(value) ? value.map(sortValue) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortValue(v)])) : value;
/** Accept formatting/native link shortening, never arbitrary user edits. */
export function canonicalContent(raw: string, path: string, universe: string[], settings: BridgeSettings): string {
  const normalize = (value: unknown): unknown => Object.prototype.toString.call(value) === "[object Date]" ? (value as Date).toISOString() : typeof value === "string" ? mapLinks(value, path, universe, settings, true) : Array.isArray(value) ? value.map(normalize) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)])) : value;
  if (path.endsWith(".md")) {
    const note = splitNote(raw);
    return JSON.stringify(sortValue(normalize(note.props))) + "\n" + mapLinks(note.body, path, universe, settings, true);
  }
  if (path.endsWith(".base")) return JSON.stringify(sortValue(normalize(parseYaml(raw))));
  return raw;
}
export interface PropertyChange {name: string; before: unknown; after?: unknown;}
export function propertyChanges(raw: string, path: string, settings: BridgeSettings): PropertyChange[] {
  if (!path.endsWith(".md") || !path.startsWith(settings.root + "/")) return [];
  const {props} = splitNote(raw);
  if (!isUUID(props.TSNotesID) || !["video", "playlist"].includes(String(props["Record Type"]))) return [];
  const changes: PropertyChange[] = [];
  const durationName = settings.fields.durationText?.name || "Duration";
  if ((props[durationName] == null || props[durationName] === "") && props["Record Type"] === "video") {
    const seconds = props[settings.fields.durationSec?.name || "Duration Seconds"];
    const formatted = formatDuration(seconds);
    if (formatted !== null) changes.push({name: durationName, before: props[durationName], after: formatted});
  }
  for (const name of deprecatedProperties(settings)) if (Object.hasOwn(props, name)) changes.push({name, before: props[name]});
  return changes;
}
export function durationDiscrepancy(raw: string, settings: BridgeSettings): boolean {
  const {props} = splitNote(raw), value = props[settings.fields.durationText?.name || "Duration"], seconds = props[settings.fields.durationSec?.name || "Duration Seconds"];
  return value != null && seconds != null && parseDuration(value) !== seconds;
}
export function obsoleteBaseReferences(raw: string): string[] {
  const value = parseYaml(raw), refs: string[] = [];
  const visit = (v: unknown, path: string) => {
    if (typeof v === "string" && /note(?:\.Title|\[(["'])Title\1\]|\[(["'])Duration Seconds\2\]|\[(["'])Parent Path\3\])/.test(v) && path !== "formulas.Title") refs.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${path}[${i}]`));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => visit(x, path ? path + "." + k : k));
  };
  visit(value, ""); return refs;
}
export function transformUpgradeContent(original: string, originalPath: string, current: string, path: string, universe: string[], settings: BridgeSettings): string {
  const linked = mapLinks(current, path, universe, settings, false);
  if (path.endsWith(".base")) {
    const paths = libraryPaths(settings);
    if (![paths.videoBase, paths.playlistBase, paths.membersBase].includes(path)) return linked;
    const data = parseYaml(linked);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("invalid_base");
    data.formulas = {...data.formulas, Title: "file.asLink(file.basename)", DurationSeconds: durationFormula(`note[${JSON.stringify(settings.fields.durationText?.name || "Duration")}]`)};
    return stringifyYaml(data);
  }
  if (originalPath === `${settings.root}/_data/README.md`) {
    const marker = "<!-- TSNotes Library v4 -->";
    if (current.includes(marker)) return linked;
    return marker + "\n" + libraryGuide(settings).content + "\n<details>\n<summary>迁移前说明与补充（保留原文，旧路径以本文最新说明为准）</summary>\n\n" + linked + "\n</details>\n";
  }
  if (!path.endsWith(".md")) return linked;
  const note = splitNote(linked), before = splitNote(original);
  let changed = false;
  for (const item of propertyChanges(original, originalPath, settings)) {
    if (item.after !== undefined) note.props[item.name] = item.after;
    else delete note.props[item.name];
    changed = true;
  }
  const relation = note.props["Relations Path"];
  if (typeof relation === "string") { const next = finalPath(relation, settings); if (next !== relation) { note.props["Relations Path"] = next; changed = true; } }
  // A user's edited resource must never be blessed as generated content.
  if (isUUID(note.props.ResourceID) && contentHash(before.body) === before.props["Imported Body Hash"] && note.body !== before.body) { note.props["Imported Body Hash"] = contentHash(note.body); changed = true; }
  return changed ? "---\n" + stringifyYaml(note.props) + "---\n" + note.body : linked;
}
