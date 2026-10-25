import { randomUUID } from "node:crypto";
import { libraryPaths, playlistEmbed } from "./library";
import {
  assertCompatible,
  defaults,
  fileName,
  identities,
  mapped,
  safePath,
  technical,
  text,
  validatePrepared,
  type Prepared,
  type Fields,
  type BridgeSettings,
} from "./model";
export interface Entry {
  path: string;
  props: Fields;
}
export interface Relation {
  version: 1;
  playlistId: string;
  sourceKey: string;
  members: { videoId: string; sourceIndex: number | null; sourceKey: string }[];
}
export interface RecordStorage {
  create: (path: string, props: Fields, initialBody?: string) => Promise<void>;
  ensureLibrary?: (settings: BridgeSettings) => Promise<void>;
  update: (path: string, change: (props: Fields) => void) => Promise<void>;
  verify: (path: string, id: string) => Promise<void>;
  exists: (path: string) => boolean;
  readRelation: (path: string) => Promise<Relation | null>;
  writeRelation: (path: string, value: Relation) => Promise<void>;
  open: (path: string) => Promise<void>;
}
const array = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(text).filter(Boolean) : text(v) ? [text(v)] : [];
export class IdentityIndex {
  entries = new Map<string, Entry>();
  private invalidPaths = new Set<string>();
  invalidate(path: string): void {
    if (this.entries.has(path)) this.invalidPaths.add(path);
  }
  private maps = new Map<string, Map<string, Set<string>>>();
  constructor() {
    for (const name of ["id", "key", "source", "url"])
      this.maps.set(name, new Map());
  }
  private values(e: Entry): Record<string, string[]> {
    return {
      id: array(e.props.TSNotesID),
      key: [...array(e.props.DedupeKey), ...array(e.props.DedupeAliases)],
      source: array(e.props["Source Identities"]),
      url: array(e.props.DedupeURL),
    };
  }
  remove(path: string): void {
    const old = this.entries.get(path);
    if (!old) return;
    for (const [kind, keys] of Object.entries(this.values(old)))
      for (const key of keys) {
        const paths = this.maps.get(kind)!.get(key);
        paths?.delete(path);
        if (!paths?.size) this.maps.get(kind)!.delete(key);
      }
    this.entries.delete(path);
    this.invalidPaths.delete(path);
  }
  set(entry: Entry): void {
    const p = entry.props;
    const hasHint =
      text(p.TSNotesID) ||
      (["video", "playlist"].includes(text(p["Record Type"])) &&
        text(p.DedupeKey));
    if (!hasHint) {
      this.invalidate(entry.path);
      return;
    }
    const invalid =
      !/^[a-f0-9-]{36}$/.test(text(p.TSNotesID)) ||
      !text(p.DedupeKey) ||
      !text(p.DedupeURL) ||
      !["video", "playlist"].includes(text(p["Record Type"])) ||
      !["youtube", "bilibili", "baidupan"].includes(text(p.Site));
    if (invalid && this.entries.has(entry.path)) {
      this.invalidate(entry.path);
      return;
    }
    this.remove(entry.path);
    if (invalid) this.invalidPaths.add(entry.path);
    this.entries.set(entry.path, entry);
    for (const [kind, keys] of Object.entries(this.values(entry)))
      for (const key of keys) {
        const map = this.maps.get(kind)!;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key)!.add(entry.path);
      }
  }
  candidates(kind: string, keys: string[]): Entry[] {
    const paths = new Set<string>();
    for (const key of keys)
      for (const path of this.maps.get(kind)?.get(key) || []) paths.add(path);
    return [...paths].map((p) => this.entries.get(p)!);
  }
  unique(entries: Entry[]): Entry | null {
    if (entries.length > 1) {
      if (
        new Set(entries.map((e) => text(e.props.TSNotesID))).size <
        entries.length
      )
        throw Error("duplicate_uuid_conflict");
      throw Error("duplicate_identity_conflict");
    }
    const e = entries[0];
    if (e && this.invalidPaths.has(e.path))
      throw Error("invalid_document_metadata");
    if (e && this.candidates("id", [text(e.props.TSNotesID)]).length !== 1)
      throw Error("duplicate_uuid_conflict");
    return e || null;
  }
  byId(id: string): Entry | null {
    return this.unique(this.candidates("id", [id]));
  }
  find(p: Prepared): Entry | null {
    const strong = [
      ...this.candidates("key", [p.record.dedupeKey]),
      ...this.candidates("source", identities(p)),
    ];
    const exact = this.unique([
      ...new Map(strong.map((e) => [e.path, e])).values(),
    ]);
    if (exact) {
      assertCompatible(exact.props, p);
      return exact;
    }
    const url = text(p.record.fields.dedupeUrl);
    if (!url) return null;
    const candidates = this.candidates("url", [url]).filter(
      (e) => e.props["Record Type"] === "video" && e.props.Site === p.site,
    );
    if (candidates.length) {
      const candidate = this.unique(candidates)!;
      assertCompatible(candidate.props, p);
      const oldSources = array(candidate.props["Source Identities"]),
        newSources = identities(p);
      if (
        oldSources.length &&
        newSources.length &&
        !oldSources.some((x) => newSources.includes(x))
      )
        throw Error("url_identity_conflict");
      return candidate;
    }
    return null;
  }
}
export class RecordService {
  readonly index = new IdentityIndex();
  maintenanceActive = false;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: RecordStorage,
    private settings: () => BridgeSettings = () => defaults,
  ) {}
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(task);
    this.tail = next;
    return next;
  }
  async maintain<T>(task: () => Promise<T>): Promise<T> {
    if (this.maintenanceActive) throw Error("library_maintenance_in_progress");
    this.maintenanceActive = true;
    try { return await this.serial(task); }
    finally { this.maintenanceActive = false; }
  }
  private async patch(
    entry: Entry,
    change: (props: Fields) => void,
  ): Promise<void> {
    const id = text(entry.props.TSNotesID);
    this.index.byId(id);
    let next: Fields = {};
    await this.storage.update(entry.path, (props) => {
      if (text(props.TSNotesID) !== id) throw Error("document_changed");
      change(props);
      next = { ...props };
    });
    this.index.set({ path: entry.path, props: next });
  }
  private path(folder: string, title: string, id: string): string {
    let path = folder + "/" + fileName(title) + ".md";
    if (this.storage.exists(path))
      path = folder + "/" + fileName(title) + "-" + id.slice(0, 8) + ".md";
    if (this.storage.exists(path)) throw Error("filename_conflict");
    return path;
  }
  async find(value: unknown): Promise<Entry | null> {
    const entry = this.index.find(validatePrepared(value));
    if (entry)
      await this.storage.verify(entry.path, text(entry.props.TSNotesID));
    return entry;
  }
  async ensure(value: unknown, open = true): Promise<unknown> {
    if (this.maintenanceActive) throw Error("library_maintenance_in_progress");
    return this.serial(async () => {
      if (this.maintenanceActive) throw Error("library_maintenance_in_progress");
      const p = validatePrepared(value),
        settings = this.settings(),
        root = libraryPaths(settings).storageRoot;
      await this.storage.ensureLibrary?.(settings);
      let entry = this.index.find(p),
        created = false,
        parent: Entry | null = null;
      if (entry)
        await this.storage.verify(entry.path, text(entry.props.TSNotesID));
      if (p.parent) {
        parent = this.index.unique(
          this.index.candidates("key", [p.parent.dedupeKey]),
        );
        if (parent)
          await this.storage.verify(parent.path, text(parent.props.TSNotesID));
        if (parent && parent.props["Record Type"] !== "playlist")
          throw Error("playlist_identity_conflict");
        if (!parent) {
          const id = randomUUID(),
            path = this.path(libraryPaths(settings).playlists, text(p.parent.fields.title), id);
          const props: Fields = {
            TSNotesID: id,
            "Record Type": "playlist",
            Site: p.site,
            DedupeKey: p.parent.dedupeKey,
            DedupeURL: text(p.parent.fields.dedupeUrl),
            "Created time": new Date().toISOString(),
            "Playlist ID": text(p.parent.fields.playlistId),
            "Relations Path": root + "/_data/playlists/" + id + ".json",
            ...mapped(p.parent.fields, settings, "playlist"),
          };
          await this.storage.create(path, props, playlistEmbed(settings));
          parent = { path, props };
          this.index.set(parent);
          await this.storage.writeRelation(text(props["Relations Path"]), {
            version: 1,
            playlistId: id,
            sourceKey: p.parent.dedupeKey,
            members: [],
          });
        }
      }
      if (!entry) {
        const id = randomUUID(),
          folder = libraryPaths(settings).videos,
          path = this.path(folder, text(p.record.fields.title), id);
        const props: Fields = {
          TSNotesID: id,
          "Record Type": "video",
          Site: p.site,
          DedupeKey: p.record.dedupeKey,
          DedupeURL: text(p.record.fields.dedupeUrl),
          "Created time": new Date().toISOString(),
          ...technical(p),
          ...mapped(p.record.fields, settings, "video"),
        };
        await this.storage.create(path, props);
        entry = { path, props };
        this.index.set(entry);
        created = true;
      } else {
        const aliases = array(entry.props.DedupeAliases),
          source = array(entry.props["Source Identities"]);
        const nextAliases =
          p.record.dedupeKey === entry.props.DedupeKey
            ? aliases
            : [...new Set([...aliases, p.record.dedupeKey])];
        const nextSource = [...new Set([...source, ...identities(p)])];
        if (
          nextAliases.length !== aliases.length ||
          nextSource.length !== source.length
        )
          await this.patch(entry, (props) => {
            if (nextAliases.length) props.DedupeAliases = nextAliases;
            Object.assign(props, technical(p));
            props["Source Identities"] = nextSource;
          });
        entry = this.index.byId(text(entry.props.TSNotesID))!;
      }
      if (parent) await this.relate(parent, entry, p);
      let opened = false,
        openError: string | undefined;
      if (open)
        try {
          await this.storage.open(entry.path);
          opened = true;
        } catch (e) {
          openError = e instanceof Error ? e.message : "open_failed";
        }
      return {
        documentId: entry.props.TSNotesID,
        path: entry.path,
        created,
        written: true,
        opened,
        openError,
      };
    });
  }
  private validateRelation(parent: Entry, relation: Relation | null): Relation {
    if (!relation) throw Error("playlist_relations_missing");
    if (
      relation.version !== 1 ||
      relation.playlistId !== parent.props.TSNotesID ||
      relation.sourceKey !== parent.props.DedupeKey ||
      !Array.isArray(relation.members)
    )
      throw Error("damaged_playlist_relations");
    const seen = new Set<string>();
    for (const member of relation.members) {
      if (
        !member ||
        typeof member.videoId !== "string" ||
        !text(member.sourceKey) ||
        (member.sourceIndex !== null &&
          (!Number.isInteger(member.sourceIndex) || member.sourceIndex < 1)) ||
        seen.has(member.videoId)
      )
        throw Error("damaged_playlist_relations");
      seen.add(member.videoId);
      const entry = this.index.byId(member.videoId);
      if (!entry || entry.props["Record Type"] !== "video")
        throw Error("playlist_member_missing_or_invalid");
    }
    return relation;
  }
  private async relate(
    parent: Entry,
    video: Entry,
    p: Prepared,
  ): Promise<void> {
    const path = safePath(text(parent.props["Relations Path"]));
    const relation = this.validateRelation(
      parent,
      await this.storage.readRelation(path),
    );
    const index = Number(p.record.fields.playlistIndex),
      sourceIndex = Number.isInteger(index) && index > 0 ? index : null;
    const member = relation.members.find(
      (m) => m.videoId === video.props.TSNotesID,
    );
    if (member) {
      if (sourceIndex != null) member.sourceIndex = sourceIndex;
    } else
      relation.members.push({
        videoId: text(video.props.TSNotesID),
        sourceIndex,
        sourceKey: p.record.dedupeKey,
      });
    relation.members.sort(
      (a, b) =>
        (a.sourceIndex ?? Number.MAX_SAFE_INTEGER) -
        (b.sourceIndex ?? Number.MAX_SAFE_INTEGER),
    );
    await this.storage.writeRelation(path, relation);
    await this.patch(parent, (props) => {
      props.Videos = relation.members
        .map((m) => this.index.byId(m.videoId))
        .filter((e): e is Entry => !!e)
        .map((e) => "[[" + e.path.replace(/\.md$/, "") + "]]");
      props["Total Videos"] = relation.members.length;
      const n = Number(p.parent!.fields.playlistVideoCount);
      if (n > 0) props["Source Total Videos"] = n;
    });
    await this.patch(video, (props) => {
      props["Playlist IDs"] = [
        ...new Set([
          ...array(props["Playlist IDs"]),
          text(parent.props.TSNotesID),
        ]),
      ];
      // Native folder renames can shorten a wikilink. Rebuild this controlled
      // projection from stable IDs rather than merging different spellings of
      // the same playlist and creating a duplicate on the next save.
      props.Playlists = array(props["Playlist IDs"])
        .map(id => this.index.byId(id))
        .filter((entry): entry is Entry => !!entry)
        .map(entry => "[[" + entry.path.replace(/\.md$/, "") + "]]");
    });
  }
  async reconcileLinks(): Promise<void> {
    return this.serial(() => this.reconcileNow());
  }
  async reconcileDuringMaintenance(allowedPaths?: Set<string>): Promise<void> {
    if (!this.maintenanceActive) throw Error("maintenance_required");
    await this.reconcileNow(allowedPaths);
  }
  private async reconcileNow(allowedPaths?: Set<string>): Promise<void> {
      for (const parent of [...this.index.entries.values()].filter(
        (e) => e.props["Record Type"] === "playlist" && (!allowedPaths || allowedPaths.has(e.path)),
      )) {
        const relation = this.validateRelation(
          parent,
          await this.storage.readRelation(
            safePath(text(parent.props["Relations Path"])),
          ),
        );
        const videos = relation.members
          .map((m) => this.index.byId(m.videoId))
          .filter((e): e is Entry => !!e)
          .map((e) => "[[" + e.path.replace(/\.md$/, "") + "]]");
        if (JSON.stringify(videos) !== JSON.stringify(parent.props.Videos))
          await this.patch(parent, (props) => {
            props.Videos = videos;
          });
      }
      for (const video of [...this.index.entries.values()].filter(
        (e) => e.props["Record Type"] === "video" && (!allowedPaths || allowedPaths.has(e.path)),
      )) {
        const links = array(video.props["Playlist IDs"])
          .map((id) => this.index.byId(id))
          .filter((e): e is Entry => !!e)
          .map((e) => "[[" + e.path.replace(/\.md$/, "") + "]]");
        if (
          links.length &&
          JSON.stringify(links) !== JSON.stringify(video.props.Playlists)
        )
          await this.patch(video, (props) => {
            props.Playlists = links;
          });
      }
  }
  async refresh(
    value: unknown,
    apply = false,
    expected?: { documentId?: unknown; changes?: unknown },
  ): Promise<unknown> {
    if (this.maintenanceActive) throw Error("library_maintenance_in_progress");
    return this.serial(async () => {
      if (this.maintenanceActive) throw Error("library_maintenance_in_progress");
      const p = validatePrepared(value),
        entry = this.index.find(p);
      if (!entry) throw Error("record_not_found");
      await this.storage.verify(entry.path, text(entry.props.TSNotesID));
      const updates = mapped(p.record.fields, this.settings(), "video", true);
      const changes = Object.fromEntries(
        Object.entries(updates).filter(
          ([key, v]) => JSON.stringify(entry.props[key]) !== JSON.stringify(v),
        ),
      );
      if (
        apply &&
        (!expected ||
          expected.documentId !== entry.props.TSNotesID ||
          JSON.stringify(expected.changes) !== JSON.stringify(changes))
      )
        throw Error("refresh_preview_changed");
      if (apply && Object.keys(changes).length)
        await this.patch(entry, (props) => Object.assign(props, changes));
      return {
        documentId: entry.props.TSNotesID,
        path: entry.path,
        changes,
        applied: apply,
      };
    });
  }
  async open(id: string): Promise<unknown> {
    const entry = this.index.byId(id);
    if (!entry) throw Error("record_not_found");
    await this.storage.verify(entry.path, id);
    await this.storage.open(entry.path);
    return { documentId: id, opened: true, path: entry.path };
  }
}
