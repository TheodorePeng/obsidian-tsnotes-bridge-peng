import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdtemp, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

class File {constructor(path) {this.path = path;} get extension() {return this.path.split(".").at(-1);} get basename() {return this.path.split("/").at(-1).replace(/\.[^.]+$/, "");}}
class Folder {constructor(path, children = []) {this.path = path; this.children = children;}}
class View {}
const native = {TFile: File, TFolder: Folder, MarkdownView: View, parseYaml: JSON.parse, stringifyYaml: value => JSON.stringify(value) + "\n"};
async function moduleAt(path, mocks = native) {
  const bundle = await build({entryPoints: [path], bundle: true, platform: "node", format: "cjs", write: false, external: ["obsidian"]});
  const mod = {exports: {}}, real = createRequire(import.meta.url);
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(name => name === "obsidian" ? mocks : real(name), mod, mod.exports); return mod.exports;
}
const c = await moduleAt("src/library-upgrade-content.ts"), {LibraryUpgrade} = await moduleAt("src/library-upgrade.ts");
const m = await moduleAt("src/model.ts"), rules = await moduleAt("src/property-rules.ts"), {PropertyPresentation} = await moduleAt("src/property-presentation.ts");
const duration = await moduleAt("src/duration.ts");
const settings = {...m.defaults, fields: {}}, id = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
const note = (props, body = "") => "---\n" + JSON.stringify(props) + "\n---\n" + body;
const video = "TSNotes/Videos/_records/Video.md", playlist = "TSNotes/Playlists/_records/Course.md", shared = "TSNotes/Playlists/_records/Playlist Videos.base", resource = `TSNotes/Resources/${id(1)}/AI.md`, image = `TSNotes/Resources/${id(1)}/assets/image.png`, relation = `TSNotes/_data/playlists/${id(2)}.json`;
const vidProps = {TSNotesID: id(1), "Record Type": "video", Site: "baidupan", DedupeKey: "video", DedupeURL: "https://pan.baidu.com/pfile/video?path=test", Title: "Original source title", Duration: "26:04", "Duration Seconds": 1565, "Parent Path": "/source", "File Path": "/source/video.mp4", Status: "Learning", Playlists: ["[[" + playlist.slice(0, -3) + "]]"], "Playlist IDs": [id(2)], "Created time": "2026-10-21T20:29:48.936Z"};
async function fixture({protectedReference = false, edited = false} = {}) {
  const body = `# AI\n![](${image})\n`, originalBodyHash = c.contentHash(body);
  const raw = new Map(Object.entries({
    [video]: note(vidProps, "我的个人笔记\n"),
    [playlist]: note({TSNotesID: id(2), "Record Type": "playlist", Site: "baidupan", DedupeKey: "playlist", DedupeURL: "https://pan.baidu.com", Title: "Course", "Relations Path": relation, Videos: ["[[" + video.slice(0, -3) + "]]"]}, `Personal course text\n![[${shared}]]\n`),
    [shared]: JSON.stringify({filters: {and: ['this.TSNotesID != null']}, formulas: {Title: 'file.asLink(note["Title"])'}, views: [{name: "My style", type: "table", order: ["formula.Title"], columnSize: {"formula.Title": 277}}]}),
    [resource]: note({ResourceID: id(3), "TSNotes Parent ID": id(1), "Resource Type": "ai-notes", "Imported Body Hash": originalBodyHash, Video: "[[" + video.slice(0, -3) + "]]"}, body + (edited ? "My private edit\n" : "")),
    [image]: Buffer.from([137, 80, 78, 71, 0, 12]),
    [relation]: JSON.stringify({version: 1, playlistId: id(2), sourceKey: "playlist", members: [{videoId: id(1), sourceKey: "video", sourceIndex: 7}]}),
    "TSNotes/_data/README.md": "My extra instructions\n[[TSNotes/Videos.base]]\n",
    "TSNotes/Videos.base": JSON.stringify({formulas: {Title: 'file.asLink(note["Title"])'}, views: [{name: "Personal table", order: ["formula.Title"], columnSize: {"formula.Title": 333}}]}),
    "TSNotes/Playlists.base": JSON.stringify({formulas: {Title: 'file.asLink(note["Title"])'}, views: [{name: "My playlist view", order: ["formula.Title"]}]}),
    "Topics/Other.md": note({Title: "Keep my unrelated title"}, "External ordinary note\n"),
    ".obsidian/plugins/tsnotes-bridge-peng/data.json": JSON.stringify(settings),
    ".obsidian/types.json": JSON.stringify({types: {tags: "tags", Title: "text"}}),
  }).map(([p, value]) => [p, Buffer.isBuffer(value) ? value : Buffer.from(value)]));
  if (protectedReference) raw.set("TSNotes QA Retained/Playlist.md", Buffer.from(`![[${shared}]]`));
  const allFiles = () => [...raw.keys()].filter(path => !path.startsWith(".")).map(path => new File(path));
  const abstract = path => raw.has(path) ? new File(path) : [...raw.keys()].some(p => p.startsWith(path + "/")) ? new Folder(path, []) : undefined;
  let crash = false, changes = 0, drafts = false;
  const app = {
    vault: {configDir: ".obsidian", getFiles: allFiles, getMarkdownFiles: () => allFiles().filter(f => f.extension === "md"), getAbstractFileByPath: abstract,
      adapter: {exists: async path => !!abstract(path), readBinary: async path => {assert(raw.has(path), "missing " + path); const b = raw.get(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);}},
      read: async file => raw.get(file.path).toString("utf8"), createFolder: async () => {}, process: async (file, change) => {raw.set(file.path, Buffer.from(change(raw.get(file.path).toString("utf8")))); changes++;}},
    workspace: {iterateAllLeaves: callback => {if (drafts) {const view = new View(); view.file = new File(video); view.getMode = () => "source"; view.editor = {getValue: () => "unsaved"}; callback({view});}}},
    metadataCache: {
      getFileCache: file => ({frontmatter: c.splitNote(raw.get(file.path).toString("utf8")).props}),
      get resolvedLinks() {const result = {}; for (const [path, bytes] of raw) {result[path] = {}; for (const match of bytes.toString("utf8").matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {const target = [...raw.keys()].find(p => p === match[1] || p === match[1] + ".md"); if (target) result[path][target] = 1;}} return result;},
    },
    fileManager: {renameFile: async (file, to) => {
      const old = file.path;
      for (const [path, data] of [...raw]) if (path === old || path.startsWith(old + "/")) {raw.delete(path); raw.set(to + path.slice(old.length), data);}
      for (const [path, bytes] of raw) if (/\.(md|base)$/.test(path)) raw.set(path, Buffer.from(bytes.toString("utf8").split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`+[^`\n]*`+)/g).map((part, i) => i % 2 ? part : part.replace(/\[\[[^\]\n]+\]\]|!?\[[^\]\n]*\]\([^\n)]+\)/g, match => match.replaceAll(old + "/", to + "/"))).join("")));
      changes++; if (crash) {crash = false; throw Error("simulated_crash_after_native_rename");}
    }},
  };
  const entries = () => {const map = new Map(); return {entries: map, remove: key => map.delete(key), set: entry => map.set(entry.path, entry)};};
  const records = {index: entries(), maintenanceActive: false, maintain: async action => {records.maintenanceActive = true; try {return await action();} finally {records.maintenanceActive = false;}}};
  const resources = {index: entries(), beginMaintenance: async () => () => {}};
  const currentSettings = structuredClone(settings);
  const local = await mkdtemp(join(tmpdir(), "tsnotes-library-v4-test-")), upgrade = new LibraryUpgrade(app, records, resources, () => currentSettings, id(9), local);
  return {app, raw, upgrade, local, settings: currentSettings, set crash(v) {crash = v;}, set drafts(v) {drafts = v;}, get changes() {return changes;}};
}

test("readable duration accepts zero, hours and total minutes, rejects invalid and unsafe values", () => {
  for (const [value, seconds] of [["00:00", 0], [" 26:04 ", 1564], ["90:00", 5400], ["100:02:03", 360123]]) assert.equal(duration.parseDuration(value), seconds);
  for (const value of [null, 0, "", "1:2", "01:60", "1:60:00", "-1:00", "1:00:60", "9007199254740991:00"]) assert.equal(duration.parseDuration(value), null);
  for (const value of [0, 1, 59, 60, 3599, 3600, 360123]) assert.equal(duration.parseDuration(duration.formatDuration(value + 0.9)), value);
  for (const value of [-1, "60", NaN, Infinity, 2 ** 53]) assert.equal(duration.formatDuration(value), null);
});
test("deprecated properties cannot return through old mapping settings; filenames and duration remain functional", () => {
  const value = m.mapped({title: "Source", durationSec: 1564, parentPath: "/x"}, {...settings, fields: {title: {enabled: true, name: "Title"}, durationSec: {enabled: true, name: "Duration Seconds"}}}, "video");
  assert.deepEqual(value, {Duration: "26:04"});
  assert(!Object.hasOwn(m.technical({site: "baidupan", record: {fields: {parentPath: "/x", fsId: "123"}}}), "Parent Path"));
  assert.throws(() => m.mapped({channel: "a"}, {...settings, fields: {channel: {name: "Title"}}}, "video"), /reserved/);
});
test("compact properties are identity scoped, preserve custom fields, and native types keep IDs as text", () => {
  assert(rules.hideProperty("TSNotesID", vidProps, settings));
  assert(!rules.hideProperty("Status", vidProps, settings)); assert(!rules.hideProperty("Created time", vidProps, settings));
  assert(!rules.hideProperty("TSNotesID", {TSNotesID: "invalid"}, settings));
  assert(!rules.hideProperty("TSNotesID", vidProps, {...settings, compactProperties: false}));
  assert(!rules.hideProperty("TSNotesID", vidProps, settings, true));
  const types = rules.nativePropertyTypes(settings); assert.equal(types["Created time"], "datetime"); assert.equal(types["File ID"], "text"); assert.equal(types.Subtitles, "multitext"); assert(!types.Title);
});
test("native shortened links compare by destination while real edits are rejected", () => {
  const universe = [video, playlist];
  const old = note({...vidProps, Playlists: ["[[" + playlist.slice(0, -3) + "]]"]}, "Keep my text");
  const next = note({...vidProps, Playlists: ["[[Course]]"]}, "Keep my text");
  assert.equal(c.canonicalContent(old, video, universe, settings), c.canonicalContent(next, c.finalPath(video, settings), universe, settings));
  assert.notEqual(c.canonicalContent(old, video, universe, settings), c.canonicalContent(next + " edit", c.finalPath(video, settings), universe, settings));
  const padded = note({ResourceID: id(3)}, `![[ ${image} ]]\nPersonal edited fixture`), shortened = note({ResourceID: id(3)}, "![[image.png]]\nPersonal edited fixture");
  assert.equal(c.canonicalContent(padded, resource, [resource, image], settings), c.canonicalContent(shortened, c.finalPath(resource, settings), [resource, image], settings));
});
test("migration previews protect QA references, refuse stale confirmation and preserve unrelated titles", async () => {
  const f = await fixture({protectedReference: true}), plan = await f.upgrade.preview();
  assert.equal(plan.protectedReferences.length, 1); assert(plan.issues.some(i => i.includes("受保护")));
  await assert.rejects(f.upgrade.apply(plan, plan.digest), /not_confirmed/); assert.equal(f.changes, 0);
  const clear = await f.upgrade.preview(plan.protectedReferences); assert.deepEqual(clear.issues, []);
  f.raw.set(video, Buffer.from(f.raw.get(video) + "new personal text"));
  await assert.rejects(f.upgrade.apply(clear, clear.digest), /stale/); assert.equal(f.changes, 0);
});
test("moves folders, preserves images/relations/body/UUID, changes only required Base formulas, and guarded rollback restores bytes", async () => {
  const f = await fixture(), original = new Map([...f.raw].map(([p, b]) => [p, Buffer.from(b)])), plan = await f.upgrade.preview();
  assert.deepEqual(plan.issues, []); assert(plan.files.find(f => f.from === video).titleDiffers); assert(plan.files.find(f => f.from === video).durationDiffers);
  const journal = await f.upgrade.apply(plan, plan.digest); assert.equal(journal.phase, "complete");
  assert(!f.raw.has(video)); const main = c.splitNote(f.raw.get(c.finalPath(video, settings)).toString());
  assert.equal(main.body, "我的个人笔记\n"); assert.equal(main.props.TSNotesID, id(1)); assert.equal(main.props.Status, "Learning"); assert.equal(main.props["Created time"], vidProps["Created time"]);
  for (const name of ["Title", "Duration Seconds", "Parent Path"]) assert(!Object.hasOwn(main.props, name));
  assert.equal(main.props.Duration, "26:04");
  assert.deepEqual(f.raw.get(c.finalPath(image, settings)), original.get(image)); assert.deepEqual(f.raw.get(c.finalPath(relation, settings)), original.get(relation));
  const ai = c.splitNote(f.raw.get(c.finalPath(resource, settings)).toString()); assert.equal(ai.props["Imported Body Hash"], c.contentHash(ai.body));
  const base = JSON.parse(f.raw.get("TSNotes/Videos.base").toString()); assert.equal(base.formulas.Title, "file.asLink(file.basename)"); assert.equal(base.views[0].columnSize["formula.Title"], 333);
  assert(f.raw.get("TSNotes/Library/_data/README.md").toString().includes("My extra instructions"));
  assert.deepEqual(f.raw.get("Topics/Other.md"), original.get("Topics/Other.md"));
  await f.upgrade.rollback(); assert.deepEqual(f.raw, original);
});
test("resource local edits retain their old generated hash after a controlled link move", async () => {
  const f = await fixture({edited: true}), old = c.splitNote(f.raw.get(resource).toString());
  const plan = await f.upgrade.preview(); await f.upgrade.apply(plan, plan.digest);
  const next = c.splitNote(f.raw.get(c.finalPath(resource, settings)).toString());
  assert.equal(next.props["Imported Body Hash"], old.props["Imported Body Hash"]); assert.notEqual(next.props["Imported Body Hash"], c.contentHash(next.body)); assert(next.body.includes("My private edit"));
});
test("an interrupted native move resumes only after semantic validation; later user edits block rollback", async () => {
  const f = await fixture(), plan = await f.upgrade.preview(); f.crash = true;
  await assert.rejects(f.upgrade.apply(plan, plan.digest), /simulated_crash/);
  const pending = await f.upgrade.latest(); assert.equal(pending.pending.kind, "move");
  const result = await f.upgrade.resume(); assert.equal(result.phase, "complete");
  const path = c.finalPath(video, settings); f.raw.set(path, Buffer.from(f.raw.get(path) + "new edit"));
  await assert.rejects(f.upgrade.rollback(), /file_changed/); assert(f.raw.get(path).toString().endsWith("new edit"));
});
test("unsaved editors, duplicate IDs, bad Base references and destination collisions stop migration", async () => {
  const f = await fixture(); f.drafts = true; const plan = await f.upgrade.preview(); await assert.rejects(f.upgrade.apply(plan, plan.digest), /unsaved/); assert.equal(f.changes, 0);
  f.drafts = false; f.raw.set("TSNotes/Videos/copy.md", Buffer.from(note(vidProps)));
  assert((await f.upgrade.preview()).issues.some(i => i.includes("重复身份")));
  f.raw.delete("TSNotes/Videos/copy.md"); f.raw.set("TSNotes/Videos.base", Buffer.from(JSON.stringify({formulas: {Mine: 'note["Duration Seconds"]'}})));
  assert((await f.upgrade.preview()).issues.some(i => i.includes("自定义 Base")));
  f.raw.set("TSNotes/Library/Videos/occupied.md", Buffer.from("human")); assert((await f.upgrade.preview()).issues.some(i => i.includes("目标目录")));
});
test("new files and damaged recovery journals fail closed; unused global property names are not deleted", async () => {
  const f = await fixture(), plan = await f.upgrade.preview(); await f.upgrade.apply(plan, plan.digest);
  f.raw.set("TSNotes/Library/Resources/new-personal-file.md", Buffer.from("personal"));
  await assert.rejects(f.upgrade.rollback(), /new_file/);
  assert.equal(JSON.parse(f.raw.get(".obsidian/types.json").toString()).types.Title, "text");
  const g = await fixture(), next = await g.upgrade.preview(); g.crash = true; await assert.rejects(g.upgrade.apply(next, next.digest), /simulated/);
  const path = join(g.local, next.id, "journal.json"), damaged = JSON.parse(await readFile(path, "utf8"));
  damaged.positions[video] = "Other/Unrelated.md";
  const {writeFile} = await import("node:fs/promises"); await writeFile(path, JSON.stringify(damaged));
  await assert.rejects(g.upgrade.resume(), /journal_conflict/);
});
test("completed migration does not lock ordinary settings changes on reload, but rollback still requires its settings", async () => {
  const f = await fixture(), plan = await f.upgrade.preview(); await f.upgrade.apply(plan, plan.digest);
  f.settings.compactProperties = false; f.settings.recordOpenMode = "tab";
  await f.upgrade.initialize(); assert.doesNotThrow(() => f.upgrade.assertReady());
  await assert.rejects(f.upgrade.rollback(), /settings_changed/);
});
test("Library layout guard blocks both record and resource initialization without producing parallel defaults", async () => {
  const storage = await moduleAt("src/obsidian-storage.ts");
  const folder = new Folder("TSNotes/Videos", [new File(video)]);
  const app = {vault: {getAbstractFileByPath: path => path === folder.path ? folder : undefined}};
  assert.throws(() => storage.assertLibraryLayout(app, settings), /migration_required/);
});
test("duration fallback and prose link changes preserve code examples and user source titles in backups", () => {
  const raw = note({...vidProps, Duration: undefined, "Duration Seconds": 65.9}, `Live [[${playlist.slice(0, -3)}]]\n\`[[${playlist.slice(0, -3)}]]\`\n`);
  const next = c.transformUpgradeContent(raw, video, raw, c.finalPath(video, settings), [video, playlist], settings), parsed = c.splitNote(next);
  assert.equal(parsed.props.Duration, "01:05"); assert(!Object.hasOwn(parsed.props, "Title"));
  assert(parsed.body.includes(`Live [[${c.finalPath(playlist, settings).slice(0, -3)}]]`));
  assert(parsed.body.includes(`\`[[${playlist.slice(0, -3)}]]\``));
});
test("property presentation handles two windows, note switches and unload without touching YAML or global hiding", () => {
  let disconnected = 0, active;
  const styles = [], doc = {head: {append: style => styles.push(style)}, createElement: () => ({remove() {styles.splice(styles.indexOf(this), 1);}}), defaultView: {MutationObserver: class {observe() {} disconnect() {disconnected++;}}}};
  const makeView = () => {const view = new View(), rows = ["TSNotesID", "Duration", "Status"].map(propertyKey => ({dataset: {propertyKey}})); view.file = new File(video); view.containerEl = {ownerDocument: doc, querySelectorAll: () => rows}; view.rows = rows; return view;};
  const one = makeView(), two = makeView(), views = [one, two]; active = one;
  const app = {workspace: {iterateAllLeaves: fn => views.forEach(view => fn({view})), getActiveViewOfType: () => active}, metadataCache: {getFileCache: file => ({frontmatter: file.path === video ? vidProps : {Title: "Unrelated"}})}};
  const presentation = new PropertyPresentation(app, () => settings); presentation.refresh();
  assert.equal(one.rows[0].dataset.tsnotesHidden, "true"); assert.equal(two.rows[0].dataset.tsnotesHidden, "true");
  assert(presentation.toggleCurrent()); assert.equal(one.rows[0].dataset.tsnotesHidden, undefined); assert.equal(two.rows[0].dataset.tsnotesHidden, "true");
  two.file = new File("Topics/Other.md"); presentation.refresh(); assert.equal(two.rows[0].dataset.tsnotesHidden, undefined);
  presentation.dispose(); assert.equal(styles.length, 0); assert.equal(disconnected, 2); assert.equal(one.rows[0].dataset.tsnotesHidden, undefined);
});
