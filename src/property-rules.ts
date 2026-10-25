import {registry, type BridgeSettings, type Fields} from "./model";

export const isUUID = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function managedProperties(props: Fields): boolean {
  return isUUID(props.TSNotesID) && ["video", "playlist"].includes(String(props["Record Type"])) ||
    isUUID(props.ResourceID) && isUUID(props["TSNotes Parent ID"]) && ["subtitle", "ai-notes"].includes(String(props["Resource Type"]));
}
const technical = [
  "TSNotesID", "Record Type", "DedupeKey", "DedupeAliases", "DedupeURL", "Source Identities",
  "Video ID", "CID", "AID", "Part", "File ID", "Object Key", "File MD5", "File Path",
  "Playlist IDs", "Playlist ID", "Relations Path", "Videos", "ResourceID", "TSNotes Parent ID",
  "Resource Type", "Source Hash", "Imported Body Hash", "Title", "Duration Seconds", "Parent Path",
];
const auxiliary = ["coverUrl", "url", "playlistUrl", "originalUrl", "channelId", "channelUrl"];
export function hiddenPropertyNames(settings: BridgeSettings): Set<string> {
  return new Set([...technical, ...auxiliary.flatMap(key => [registry[key].name, settings.fields[key]?.name || registry[key].name])].map(name => name.toLowerCase()));
}
export function hideProperty(name: string, props: Fields, settings: BridgeSettings, revealed = false): boolean {
  if (settings.compactProperties === false || revealed || !managedProperties(props)) return false;
  if (hiddenPropertyNames(settings).has(name.toLowerCase())) return true;
  const daily = ["Site", "Creator", "Duration", "Created time", "URL-TSNotes", "Playlists", "Subtitles", "AI Notes", "Language", "Video"];
  if (!daily.some(key => key.toLowerCase() === name.toLowerCase())) return false;
  const key = Object.keys(props).find(key => key.toLowerCase() === name.toLowerCase());
  const value = key ? props[key] : undefined;
  return value == null || value === "" || Array.isArray(value) && !value.length;
}

export function deprecatedProperties(settings: BridgeSettings): string[] {
  return [...new Set(["Title", "Duration Seconds", "Parent Path", settings.fields.title?.name, settings.fields.durationSec?.name].filter((v): v is string => !!v))];
}
export type NativePropertyType = "text" | "multitext" | "number" | "date" | "datetime";
export function nativePropertyTypes(settings: BridgeSettings): Record<string, NativePropertyType> {
  const result: Record<string, NativePropertyType> = {};
  for (const name of technical.filter(n => !["Title", "Duration Seconds", "Parent Path", "Videos", "Playlist IDs", "DedupeAliases", "Source Identities"].includes(n))) result[name] = "text";
  for (const name of ["Playlists", "Playlist IDs", "Videos", "Subtitles", "AI Notes", "DedupeAliases", "Source Identities"]) result[name] = "multitext";
  for (const name of ["Created time", "Imported time", "Updated time"]) result[name] = "datetime";
  for (const name of ["Total Videos", "Source Total Videos"]) result[name] = "number";
  for (const [key, base] of Object.entries(registry)) {
    const rule = {...base, ...settings.fields[key]};
    if (rule.enabled) result[rule.name] = rule.type === "list" ? "multitext" : rule.type;
  }
  result.Video = "text"; result.Language = "text";
  return result;
}
