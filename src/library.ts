import { safePath, registry, type BridgeSettings } from "./model";
import { libraryGuideContent } from "./library-guide";

export const LIBRARY_VERSION = 2;
export function libraryPaths(settings: BridgeSettings) {
  const root = safePath(settings.root);
  return {
    root,
    videos: safePath(`${root}/${settings.videos}/_records`),
    playlists: safePath(`${root}/${settings.playlists}/_records`),
    videoBase: safePath(`${root}/${settings.videos}/Videos.base`),
    playlistBase: safePath(`${root}/${settings.playlists}/Playlists.base`),
    membersBase: safePath(`${root}/${settings.playlists}/_records/Playlist Videos.base`),
    readme: safePath(`${root}/${settings.playlists}/_records/README.md`),
  };
}

export function playlistEmbed(settings: BridgeSettings): string {
  return `\n<!-- TSNotes playlist view -->\n![[${libraryPaths(settings).membersBase}]]\n<!-- /TSNotes playlist view -->\n`;
}

export function appendPlaylistEmbed(content: string, settings: BridgeSettings): string {
  if (content.includes("<!-- TSNotes playlist view -->") || content.includes(`![[${libraryPaths(settings).membersBase}]]`)) return content;
  return content + (content.endsWith("\n") ? "" : "\n") + playlistEmbed(settings);
}

export interface LibraryView { path: string; content: string; }
export function libraryGuide(settings: BridgeSettings): LibraryView {
  const paths = libraryPaths(settings);
  return { path: paths.readme, content: libraryGuideContent(paths) };
}
// JSON is valid YAML. Obsidian may normalize these files to YAML when the user edits a view.
export function libraryViews(settings: BridgeSettings): LibraryView[] {
  const paths = libraryPaths(settings);
  const field = (key: string): string => {
    const original = registry[key].name;
    const name = settings.fields[key]?.name || original;
    const prop = `note[${JSON.stringify(name)}]`;
    return name === original ? prop : `if(${prop}, ${prop}, note[${JSON.stringify(original)}])`;
  };
  const formulas = {
    Title: `file.asLink(if(${field("title")}, ${field("title")}, file.name))`,
    Creator: field("channel"),
    Duration: field("durationText"),
    Play: `if(${field("urlTsnotes")}, link(${field("urlTsnotes")}, icon("play")), "")`,
    Cover: `if(${field("coverUrl")}, ${field("coverUrl")}, "")`,
  };
  const properties = {
    "formula.Title": { displayName: "Title" },
    "formula.Creator": { displayName: "Creator" },
    "formula.Duration": { displayName: "Duration" },
    "formula.Play": { displayName: "Play" },
    "formula.Sequence": { displayName: "List order" },
    "note.Created time": { displayName: "Created" },
    "note.Total Videos": { displayName: "Saved videos" },
    "note.Source Total Videos": { displayName: "Source videos" },
  };
  const scope = (kind: string) => ({ and: ['file.ext == "md"', 'note.TSNotesID != null', `note["Record Type"] == "${kind}"`] });
  const columns = ["formula.Title", "formula.Creator", "note.Site", "formula.Duration", "note.Playlists", "note.Created time", "formula.Play"];
  const table = (name: string) => ({ type: "table", name, order: columns, sort: [{ property: "note.Created time", direction: "DESC" }] });
  const view = (path: string, config: unknown): LibraryView => ({ path, content: JSON.stringify(config, null, 2) + "\n" });
  return [
    view(paths.videoBase, {
      filters: scope("video"), formulas, properties,
      views: [
        table("All videos"),
        { ...table("Standalone"), filters: '!note["Playlist IDs"] || note["Playlist IDs"].isEmpty()' },
        { ...table("By site"), groupBy: { property: "note.Site", direction: "ASC" } },
        { type: "cards", name: "Gallery", order: ["formula.Title", "formula.Creator", "formula.Duration", "formula.Play"], image: "formula.Cover", imageFit: "cover", imageAspectRatio: 1.77778 },
      ],
    }),
    view(paths.playlistBase, {
      filters: scope("playlist"), formulas, properties,
      views: [{ ...table("Playlists"), order: ["formula.Title", "formula.Creator", "note.Site", "note.Total Videos", "note.Source Total Videos", "note.Created time"] }],
    }),
    view(paths.membersBase, {
      filters: { and: [...scope("video").and, 'this["Record Type"] == "playlist"', 'this.TSNotesID != null', 'list(note["Playlist IDs"]).contains(this.TSNotesID)'] },
      formulas: { ...formulas, Sequence: 'list(this.Videos).map(if(value == file, index + 1, null)).filter(value != null)[0]' },
      properties,
      views: [{ type: "table", name: "Playlist videos", order: ["formula.Sequence", ...columns.filter(p => p !== "note.Playlists")], sort: [{ property: "formula.Sequence", direction: "ASC" }] }],
    }),
  ];
}
