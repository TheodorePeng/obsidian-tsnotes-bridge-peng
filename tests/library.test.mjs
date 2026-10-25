import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
async function moduleAt(path, mocks = {}) {
  const b = await build({ entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"] });
  const mod = { exports: {} }, real = createRequire(import.meta.url);
  new Function("require", "module", "exports", b.outputFiles[0].text)(name => mocks[name] || real(name), mod, mod.exports); return mod.exports;
}
const lib = await moduleAt("src/library.ts"), migration = await moduleAt("src/library-migration.ts");
const { RecordService } = await moduleAt("src/records.ts");
const settings = { root: "TSNotes", videos: "Videos", playlists: "Playlists", fields: {}, vaultId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const encode = (props, body = "") => "---\n" + JSON.stringify(props) + "\n---\n" + body;
const props = raw => raw.startsWith("---\n") ? JSON.parse(raw.split("---\n")[1]) : {};
const body = raw => raw.split("---\n")[2] || "";
const identity = (n, kind, extra = {}) => ({ TSNotesID: id(n), "Record Type": kind, Site: "youtube", DedupeKey: "key" + n, DedupeURL: "https://www.youtube.com/watch?v=abcdefghijk", ...extra });
function fixture() {
  const first = "TSNotes/Playlists/Course/one.md", second = "TSNotes/Videos/two.md", index = "TSNotes/Playlists/Course/Playlist.md", relation = `TSNotes/_data/playlists/${id(3)}.json`, external = "Topics/Unmoved.md";
  const files = new Map([
    [first, encode(identity(1, "video", { Title: "One", "Playlist IDs": [id(3)], Playlists: ["[[" + index.slice(0, -3) + "]]"] }), "保留个人正文\n")],
    [second, encode(identity(2, "video", { Title: "Two" }), "keep me")],
    [index, encode(identity(3, "playlist", { Title: "Course", "Relations Path": relation, Videos: ["[[" + first.slice(0, -3) + "]]"] }), "My course description\n")],
    [relation, JSON.stringify({ version: 1, playlistId: id(3), sourceKey: "key3", members: [{ videoId: id(1), sourceIndex: 7, sourceKey: "key1" }] })],
    [external, "[[" + first.slice(0, -3) + "]]"],
    [".obsidian/plugins/tsnotes-bridge-peng/data.json", JSON.stringify(settings)],
  ]);
  let saved, drafts = false, interrupt = false;
  const names = { first, second, index, relation, external };
  const io = {
    validatePath: path => { if (path.startsWith(".")) assert.equal(path, ".obsidian/plugins/tsnotes-bridge-peng/data.json"); },
    scan: async () => ({ files: [...files].filter(([path]) => /\.(md|base|canvas)$/.test(path)).map(([path, content]) => ({ path, content, props: props(content), links: [...content.matchAll(/\[\[([^\]|]+)\]\]/g)].map(m => m[1].endsWith(".base") ? m[1] : m[1] + ".md") })), extras: Object.fromEntries([...files].filter(([p]) => p.endsWith(".json"))) }),
    read: async path => files.get(path) ?? null, props,
    assertNoDrafts: async () => { if (drafts) throw Error("unsaved_editor"); },
    rename: async (from, to) => { assert(!files.has(to)); const value = files.get(from); assert(value); files.delete(from); files.set(to, value); for (const [path, content] of files) files.set(path, content.replaceAll(from.slice(0, -3), to.slice(0, -3))); },
    write: async (path, content, expected) => { assert.equal(migration.hash(files.get(path)), expected); files.set(path, content); },
    reconcile: async () => {}, trashEmpty: async () => {}, syncIndex: async () => {},
    saveJournal: async journal => { saved = structuredClone(journal); if (interrupt && !journal.pending && journal.phase === "moving" && journal.step === 1) { interrupt = false; throw Error("simulated_interruption"); } },
  };
  return { files, io, names, get saved() { return saved; }, set drafts(v) { drafts = v; }, set interrupt(v) { interrupt = v; } };
}

test("Bases query stable identities, embedded context and existing ordered links; configurable names do not rename Properties", () => {
  const views = lib.libraryViews(settings), video = JSON.parse(views[0].content), playlist = JSON.parse(views[1].content), members = JSON.parse(views[2].content);
  assert.equal(views[2].path, "TSNotes/Library/Playlists/_records/Playlist Videos.base");
  assert(lib.playlistEmbed(settings).includes("![[TSNotes/Library/Playlists/_records/Playlist Videos.base]]"));
  assert.deepEqual(video.views.map(v => v.name), ["All videos", "Standalone", "By site", "Gallery"]);
  assert(!JSON.stringify(video.filters).includes("inFolder"));
  assert(members.filters.and.includes('this["Record Type"] == "playlist"'));
  assert(members.filters.and.includes('list(note["Playlist IDs"]).contains(this.TSNotesID)'));
  assert(members.formulas.Sequence.includes("index + 1")); assert(members.formulas.Sequence.includes("value == file"));
  assert.equal(playlist.views[0].order.includes("note.Total Videos"), true);
  const changed = JSON.parse(lib.libraryViews({ ...settings, fields: { title: { name: "名称" } } })[0].content);
  assert.equal(changed.formulas.Title, "file.asLink(file.basename)");
  const original = "---\nfoo: bar\n---\nHuman course notes\n";
  const appended = lib.appendPlaylistEmbed(original, settings);
  assert(appended.startsWith(original)); assert.equal(lib.appendPlaylistEmbed(appended, settings), appended);
});

test("all new video records use one central folder, Playlist indexes embed Base, duplicate save preserves body", async () => {
  const files = new Map(), relations = new Map();
  const storage = { exists: path => files.has(path), verify: async (path, uuid) => assert.equal(files.get(path).props.TSNotesID, uuid), create: async (path, p, b = "") => files.set(path, { props: structuredClone(p), body: b }), update: async (path, change) => change(files.get(path).props), open: async () => {}, readRelation: async path => structuredClone(relations.get(path)), writeRelation: async (path, value) => relations.set(path, structuredClone(value)) };
  const service = new RecordService(storage, () => settings), video = { site: "youtube", mode: "playlist_video", record: { dedupeKey: "yt:v:abcdefghijk", fields: { title: "One", videoId: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk", dedupeUrl: "https://www.youtube.com/watch?v=abcdefghijk" } }, parent: { dedupeKey: "yt:pl:one", fields: { title: "Course", playlistId: "one", dedupeUrl: "https://www.youtube.com/playlist?list=one" } } };
  const first = await service.ensure(video); assert.equal(first.path, "TSNotes/Library/Videos/_records/One.md");
  const parent = [...files].find(([, f]) => f.props["Record Type"] === "playlist"); assert.equal(parent[0], "TSNotes/Library/Playlists/_records/Course.md"); assert(parent[1].body.includes("Playlist Videos.base"));
  files.get(first.path).body = "User notes"; await service.ensure(video); assert.equal(files.get(first.path).body, "User notes");
  let release; const operation = service.maintain(() => new Promise(resolve => { release = resolve; })); await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(() => service.ensure(video), /maintenance/); release(); await operation; assert.equal(service.maintenanceActive, false);
});

test("missing view initialization is serialized and preserves customized Bases and the local guide", async () => {
  class File { constructor(path, content) { this.path = path; this.content = content; } }
  const files = new Map(), app = { vault: { getAbstractFileByPath: path => files.get(path), createFolder: async path => { assert(!files.has(path)); files.set(path, {}); }, create: async (path, content) => { assert(!files.has(path)); files.set(path, new File(path, content)); } } };
  const storage = await moduleAt("src/obsidian-storage.ts", { obsidian: { TFile: File, TFolder: class {} } });
  await Promise.all([storage.ensureLibraryViews(app, settings), storage.ensureLibraryViews(app, settings)]);
  const bases = [...files.values()].filter(f => f instanceof File && f.path.endsWith(".base")); assert.equal(bases.length, 3);
  const guide = files.get("TSNotes/Library/_data/README.md");
  assert(guide.content.includes("this")); assert(guide.content.includes("_data/playlists"));
  assert.equal((guide.content.match(/^```$/gm) || []).length, 6);
  guide.content += "\nPersonal instructions";
  bases[0].content = "user custom Base"; await storage.ensureLibraryViews(app, settings); assert.equal(bases[0].content, "user custom Base");
  assert(guide.content.endsWith("Personal instructions"));
  const customized = lib.libraryGuide({ ...settings, root: "Learning", videos: "Clips", playlists: "Courses" });
  assert.equal(customized.path, "Learning/Library/_data/README.md");
  assert(customized.content.includes("![[Learning/Library/Courses/_records/Playlist Videos.base]]"));
  assert(!customized.content.includes("TSNotes/Playlists/"));
});

test("an unmoved legacy shared Base is preserved and does not get a competing default view", async () => {
  class File { constructor(path, content) { this.path = path; this.content = content; } }
  const legacy = new File("TSNotes/_data/views/Playlist Videos.base", "customized old Base");
  const files = new Map([[legacy.path, legacy]]);
  const app = { vault: { getAbstractFileByPath: path => files.get(path), create: async () => { throw Error("unexpected create"); } } };
  const storage = await moduleAt("src/obsidian-storage.ts", { obsidian: { TFile: File, TFolder: class {} } });
  await assert.rejects(() => storage.ensureLibraryViews(app, settings), /迁移|移动/);
  assert.equal(files.size, 1); assert.equal(legacy.content, "customized old Base");
});

test("migration requires exact preview and preserves identity, body, relations and outside note paths; rollback restores bytes", async () => {
  const f = fixture(), before = new Map(f.files), plan = migration.planLibraryMigration(await f.io.scan(), settings);
  assert.deepEqual(plan.counts, { videos: 2, playlists: 1, externalReferences: 1 }); assert.deepEqual(plan.errors, []); assert.deepEqual(f.files, before);
  await assert.rejects(() => migration.beginLibraryMigration(plan, "wrong", f.io), /confirmation/); assert.equal(f.saved, undefined);
  const journal = await migration.beginLibraryMigration(plan, plan.digest, f.io); assert.deepEqual(f.files, before); assert(journal.before[f.names.relation]);
  await migration.runLibraryMigration(journal, f.io); assert.equal(journal.phase, "complete");
  for (const item of plan.items) { assert.equal(props(f.files.get(item.to)).TSNotesID, item.id); if (item.kind === "video") assert.equal(body(f.files.get(item.to)), body(before.get(item.from))); }
  assert(f.files.has(f.names.external)); assert(f.files.get(f.names.external).includes("Videos/_records/one"));
  assert.equal(f.files.get(f.names.relation), before.get(f.names.relation));
  assert(f.files.get("TSNotes/Library/Playlists/_records/Course.md").includes("My course description"));
  await migration.rollbackLibraryMigration(journal, f.io); assert.equal(journal.phase, "rolled-back"); assert.deepEqual(f.files, before);
});

test("preview refuses changed files, unsaved editors, duplicates, damaged relationships and case-insensitive collisions", async () => {
  for (const change of [f => f.files.set(f.names.first, f.files.get(f.names.first) + "user edit"), f => { f.drafts = true; }]) {
    const f = fixture(), plan = migration.planLibraryMigration(await f.io.scan(), settings); change(f);
    await assert.rejects(() => migration.beginLibraryMigration(plan, plan.digest, f.io), /changed|unsaved/); assert.equal(f.saved, undefined);
  }
  const f = fixture(); f.files.set("Other/duplicate.md", f.files.get(f.names.first));
  assert(migration.planLibraryMigration(await f.io.scan(), settings).errors.some(e => e.includes("Duplicate")));
  f.files.delete("Other/duplicate.md"); f.files.set(f.names.relation, "{}");
  assert(migration.planLibraryMigration(await f.io.scan(), settings).errors.some(e => e.includes("relationship")));
  const c = fixture(); c.files.set("TSNotes/Library/Videos/_records/ONE.md", "human file");
  const plan = migration.planLibraryMigration(await c.io.scan(), settings); assert(plan.items.find(i => i.id === id(1)).to.includes(id(1).slice(0, 8)));
});

test("migration backs up related notes outside the root without including independent libraries", async () => {
  const f = fixture(), unrelatedRelation = `QA/_data/playlists/${id(13)}.json`;
  f.files.set("QA/Video.md", encode(identity(11, "video", { "Playlist IDs": [id(13)] })));
  f.files.set("QA/Playlist.md", encode(identity(13, "playlist", { "Relations Path": unrelatedRelation })));
  f.files.set(unrelatedRelation, JSON.stringify({ version: 1, playlistId: id(13), sourceKey: "key13", members: [{ videoId: id(11), sourceIndex: 1, sourceKey: "key11" }] }));
  // This note has a stable membership but no resolved wikilink yet.
  f.files.set("Topics/Related.md", encode(identity(12, "video", { "Playlist IDs": [id(3)] })));
  const plan = migration.planLibraryMigration(await f.io.scan(), settings);
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.counts.externalReferences, 2);
  assert("Topics/Related.md" in plan.expected);
  assert(!("QA/Playlist.md" in plan.expected));
  assert(!("QA/Video.md" in plan.expected));
  assert(!(unrelatedRelation in plan.expected));
  assert(plan.items.every(item => item.from.startsWith("TSNotes/")));
});

test("a checkpointed interruption resumes; late edits and new backlinks prevent rollback; uncertain steps never resume automatically", async () => {
  const f = fixture(), plan = migration.planLibraryMigration(await f.io.scan(), settings), journal = await migration.beginLibraryMigration(plan, plan.digest, f.io);
  f.interrupt = true; await assert.rejects(() => migration.runLibraryMigration(journal, f.io), /interruption/);
  const recovered = structuredClone(f.saved); assert.equal(recovered.step, 1); assert.equal(recovered.pending, undefined);
  await migration.runLibraryMigration(recovered, f.io); assert.equal(recovered.phase, "complete");
  const path = recovered.plan.items[0].to, unchanged = f.files.get(path); f.files.set(path, unchanged + " new user edits");
  await assert.rejects(() => migration.rollbackLibraryMigration(recovered, f.io), /file_changed/); assert(f.files.get(path).endsWith(" new user edits"));
  f.files.set(path, unchanged); f.files.set("Topics/New.md", `[[${path.slice(0, -3)}]]`);
  await assert.rejects(() => migration.rollbackLibraryMigration(recovered, f.io), /new_references/);
  recovered.pending = "move:uncertain"; await assert.rejects(() => migration.runLibraryMigration(recovered, f.io), /requires_review/);
});


test("damaged backup journals cannot restore or resume any file", async () => {
  const f = fixture(), plan = migration.planLibraryMigration(await f.io.scan(), settings), journal = await migration.beginLibraryMigration(plan, plan.digest, f.io);
  journal.before[f.names.first] += "corruption";
  const before = new Map(f.files);
  await assert.rejects(() => migration.runLibraryMigration(journal, f.io), /backup_damaged/);
  await assert.rejects(() => migration.rollbackLibraryMigration(journal, f.io), /backup_damaged/);
  assert.deepEqual(f.files, before);
});
