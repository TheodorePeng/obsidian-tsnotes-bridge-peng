import { createHash, randomUUID } from "node:crypto";
import { fileName, safePath, text, type BridgeSettings, type Fields } from "./model";
import { appendPlaylistEmbed, libraryPaths, libraryViews } from "./library";

export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
export interface MigrationFile { path: string; content: string; props?: Fields; links: string[]; }
export interface MigrationSnapshot { files: MigrationFile[]; extras: Record<string, string>; issues?: string[]; occupiedPaths?: string[]; }
export interface MigrationItem { id: string; kind: "video" | "playlist"; from: string; to: string; }
export interface MigrationPlan {
  version: 1; id: string; digest: string; settings: BridgeSettings;
  items: MigrationItem[]; expected: Record<string, string | null>;
  emptyFolders: string[]; errors: string[]; counts: { videos: number; playlists: number; externalReferences: number };
}
export interface MigrationJournal {
  version: 1; id: string; plan: MigrationPlan; before: Record<string, string | null>;
  expected: Record<string, string | null>; step: number;
  phase: "moving" | "embedding" | "reconciling" | "cleanup" | "complete" | "rollback" | "rolled-back";
  pending?: string; error?: string; rollbackStep?: number;
}
export interface MigrationIO {
  validatePath?: (path: string) => void;
  scan: () => Promise<MigrationSnapshot>;
  read: (path: string) => Promise<string | null>;
  props: (content: string) => Fields;
  assertNoDrafts: (paths: string[]) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  write: (path: string, content: string, expectedHash: string) => Promise<void>;
  reconcile: (allowedPaths: Set<string>) => Promise<void>;
  trashEmpty: (path: string) => Promise<void>;
  saveJournal: (journal: MigrationJournal) => Promise<void>;
  syncIndex: () => Promise<void>;
}
const managed = (file: MigrationFile): boolean => !!file.props?.TSNotesID || ["video", "playlist"].includes(text(file.props?.["Record Type"])) && !!file.props?.DedupeKey;
const pathKey = (path: string): string => path.normalize("NFC").toLowerCase();

export function migrationDigest(plan: Omit<MigrationPlan, "digest"> | MigrationPlan): string {
  const { digest: _ignored, ...value } = plan as MigrationPlan;
  return hash(JSON.stringify(value));
}

export function planLibraryMigration(snapshot: MigrationSnapshot, settings: BridgeSettings): MigrationPlan {
  const paths = libraryPaths(settings), all = snapshot.files.filter(managed);
  const scoped = all.filter(f => f.path.startsWith(paths.root + "/")).sort((a, b) => a.path.localeCompare(b.path));
  const occupied = new Set([...snapshot.files.map(f => pathKey(f.path)), ...Object.keys(snapshot.extras).map(pathKey), ...(snapshot.occupiedPaths || []).map(pathKey)]);
  const errors: string[] = [...(snapshot.issues || [])], items: MigrationItem[] = [];
  for (const file of scoped) {
    const props = file.props!, id = text(props.TSNotesID), kind = text(props["Record Type"]);
    if (!/^[a-f0-9-]{36}$/.test(id) || !["video", "playlist"].includes(kind) || !props.DedupeKey || !props.DedupeURL) { errors.push(`Invalid identity: ${file.path}`); continue; }
    if (all.filter(f => f.props?.TSNotesID === id).length !== 1) { errors.push(`Duplicate UUID: ${id}`); continue; }
    const folder = kind === "video" ? paths.videos : paths.playlists;
    const basename = kind === "video" ? file.path.slice(file.path.lastIndexOf("/") + 1, -3) : fileName(text(props.Title) || file.path.slice(0, file.path.lastIndexOf("/")).split("/").pop() || "Playlist");
    let to = `${folder}/${basename}.md`;
    if (pathKey(to) !== pathKey(file.path) && occupied.has(pathKey(to))) to = `${folder}/${basename}-${id.slice(0, 8)}.md`;
    if (pathKey(to) !== pathKey(file.path) && occupied.has(pathKey(to))) { errors.push(`Filename conflict: ${to}`); continue; }
    occupied.add(pathKey(to)); items.push({ id, kind: kind as "video" | "playlist", from: file.path, to });
  }
  const movingItems = items.filter(i => i.from !== i.to), moving = new Set(movingItems.map(i => i.from));
  const videoIds = new Set(movingItems.filter(i => i.kind === "video").map(i => i.id));
  const playlistIds = new Set(movingItems.filter(i => i.kind === "playlist").map(i => i.id));
  const affected = new Set(items.map(i => i.from));
  for (const file of snapshot.files) {
    let related = false;
    if (managed(file)) {
      const memberships = file.props?.["Playlist IDs"];
      related = Array.isArray(memberships) && memberships.some(value => playlistIds.has(String(value)));
      if (file.props?.["Record Type"] === "playlist") {
        try { related ||= JSON.parse(snapshot.extras[text(file.props["Relations Path"])] || "null")?.members?.some((member: {videoId?: string}) => videoIds.has(String(member.videoId))) === true; } catch { /* Validated below when affected. */ }
      }
    }
    if (related || file.links.some(path => moving.has(path))) affected.add(file.path);
  }
  const relationPaths = new Set<string>();
  for (const parent of all.filter(f => f.props?.["Record Type"] === "playlist" && affected.has(f.path))) {
    const path = text(parent.props?.["Relations Path"]), content = snapshot.extras[path]; relationPaths.add(path);
    try {
      const relation = JSON.parse(content || "null");
      if (!relation || relation.version !== 1 || relation.playlistId !== parent.props?.TSNotesID || relation.sourceKey !== parent.props?.DedupeKey || !Array.isArray(relation.members)) throw Error();
      const seen = new Set<string>();
      for (const member of relation.members) {
        if (!member || typeof member.videoId !== "string" || !member.sourceKey || seen.has(member.videoId) || member.sourceIndex !== null && (!Number.isInteger(member.sourceIndex) || member.sourceIndex < 1) || all.filter(f => f.props?.TSNotesID === member.videoId && f.props?.["Record Type"] === "video").length !== 1) throw Error();
        seen.add(member.videoId);
      }
    } catch { errors.push(`Missing or damaged relationship data: ${parent.path}`); }
  }
  const expected: Record<string, string | null> = {};
  for (const path of [...affected].sort()) expected[path] = hash(snapshot.files.find(f => f.path === path)!.content);
  for (const item of items) if (!(item.to in expected)) expected[item.to] = null;
  for (const [path, content] of Object.entries(snapshot.extras).sort()) if (relationPaths.has(path) || !/\/_data\/playlists\//.test(path)) expected[path] = hash(content);
  for (const view of libraryViews(settings)) if (!(view.path in expected)) expected[view.path] = snapshot.files.find(f => f.path === view.path) ? hash(snapshot.files.find(f => f.path === view.path)!.content) : null;
  const folders = new Set<string>();
  const retained = new Set([paths.root, `${paths.root}/${settings.videos}`, `${paths.root}/${settings.playlists}`, paths.videos, paths.playlists]);
  for (const item of items.filter(i => i.from !== i.to)) {
    let folder = item.from.slice(0, item.from.lastIndexOf("/"));
    while (folder.startsWith(paths.root + "/") && !retained.has(folder)) { folders.add(folder); folder = folder.slice(0, folder.lastIndexOf("/")); }
  }
  const plan: MigrationPlan = { version: 1, id: randomUUID(), digest: "", settings: structuredClone(settings), items, expected,
    emptyFolders: [...folders].sort((a, b) => b.split("/").length - a.split("/").length), errors,
    counts: { videos: items.filter(i => i.kind === "video").length, playlists: items.filter(i => i.kind === "playlist").length,
      externalReferences: [...affected].filter(p => !p.startsWith(paths.root + "/")).length } };
  plan.digest = migrationDigest(plan); return plan;
}

async function verifyExpected(io: MigrationIO, expected: Record<string, string | null>): Promise<void> {
  for (const [path, wanted] of Object.entries(expected)) {
    if (io.validatePath) io.validatePath(path); else safePath(path);
    const value = await io.read(path);
    if ((value === null ? null : hash(value)) !== wanted) throw Error(`migration_file_changed: ${path}`);
  }
  await io.assertNoDrafts(Object.keys(expected));
}
async function checkpoint(io: MigrationIO, journal: MigrationJournal): Promise<void> {
  for (const path of Object.keys(journal.expected)) { const value = await io.read(path); journal.expected[path] = value === null ? null : hash(value); }
  delete journal.pending; await io.saveJournal(journal);
}
async function step(io: MigrationIO, journal: MigrationJournal, name: string, action: () => Promise<void>): Promise<void> {
  await verifyExpected(io, journal.expected);
  journal.pending = name; await io.saveJournal(journal);
  await action(); await checkpoint(io, journal);
}
function validateJournal(journal: MigrationJournal): void {
  if (journal.version !== 1 || journal.id !== journal.plan.id || journal.plan.digest !== migrationDigest(journal.plan) || !Number.isInteger(journal.step) || journal.step < 0 || journal.step > journal.plan.items.length) throw Error("migration_journal_conflict");
  const paths = Object.keys(journal.plan.expected).sort();
  if (JSON.stringify(Object.keys(journal.before).sort()) !== JSON.stringify(paths) || JSON.stringify(Object.keys(journal.expected).sort()) !== JSON.stringify(paths)) throw Error("migration_journal_scope_changed");
  for (const path of paths) {
    const content = journal.before[path];
    if ((content === null ? null : typeof content === "string" ? hash(content) : undefined) !== journal.plan.expected[path]) throw Error("migration_backup_damaged");
  }
}
export async function beginLibraryMigration(plan: MigrationPlan, confirmedDigest: string, io: MigrationIO): Promise<MigrationJournal> {
  if (confirmedDigest !== plan.digest || migrationDigest(plan) !== plan.digest) throw Error("migration_confirmation_changed");
  if (plan.errors.length) throw Error("migration_conflicts_require_resolution");
  await verifyExpected(io, plan.expected);
  const latest = planLibraryMigration(await io.scan(), plan.settings);
  // Re-scan identities and backlinks; no unpreviewed reference may join this operation.
  if (latest.errors.length || JSON.stringify(latest.items) !== JSON.stringify(plan.items) || JSON.stringify(Object.keys(latest.expected).sort()) !== JSON.stringify(Object.keys(plan.expected).sort())) throw Error("migration_preview_stale");
  const before: Record<string, string | null> = {};
  for (const path of Object.keys(plan.expected)) before[path] = await io.read(path);
  const journal: MigrationJournal = { version: 1, id: plan.id, plan, before, expected: { ...plan.expected }, step: 0, phase: "moving" };
  await io.saveJournal(journal); // All note, relation, Base and config bytes exist in the private journal before the first rename.
  return journal;
}
export async function runLibraryMigration(journal: MigrationJournal, io: MigrationIO): Promise<void> {
  validateJournal(journal);
  if (journal.pending) throw Error("migration_pending_step_requires_review");
  if (["complete", "rolled-back"].includes(journal.phase)) return;
  if (journal.phase === "rollback") throw Error("migration_rollback_in_progress");
  await verifyExpected(io, journal.expected);
  try {
    if (journal.phase === "moving") {
      while (journal.step < journal.plan.items.length) {
        const item = journal.plan.items[journal.step];
        await step(io, journal, `move:${item.id}`, async () => {
          if (item.from !== item.to) await io.rename(item.from, item.to);
          if (io.props((await io.read(item.to)) || "").TSNotesID !== item.id) throw Error("migration_identity_changed");
          journal.step++;
        });
      }
      journal.phase = "embedding"; await io.saveJournal(journal);
    }
    if (journal.phase === "embedding") {
      for (const item of journal.plan.items.filter(i => i.kind === "playlist")) {
        const value = await io.read(item.to); if (value === null) throw Error("migration_document_missing");
        const next = appendPlaylistEmbed(value, journal.plan.settings);
        if (next !== value) await step(io, journal, `embed:${item.id}`, () => io.write(item.to, next, hash(value)));
      }
      journal.phase = "reconciling"; await io.saveJournal(journal);
    }
    if (journal.phase === "reconciling") {
      await step(io, journal, "reconcile", async () => { await io.syncIndex(); await io.reconcile(new Set(Object.keys(journal.expected))); });
      for (const item of journal.plan.items) if (io.props((await io.read(item.to)) || "").TSNotesID !== item.id) throw Error("migration_identity_changed");
      // Source relationship JSON is authoritative and must remain byte-identical.
      for (const [path, original] of Object.entries(journal.before)) if (/\/_data\/playlists\/[^/]+\.json$/.test(path) && await io.read(path) !== original) throw Error("migration_relation_changed");
      journal.phase = "cleanup"; await io.saveJournal(journal);
    }
    if (journal.phase === "cleanup") {
      for (const folder of journal.plan.emptyFolders) await io.trashEmpty(folder);
      journal.phase = "complete"; await io.saveJournal(journal);
    }
  } catch (error) { journal.error = error instanceof Error ? error.message : "migration_failed"; await io.saveJournal(journal); throw error; }
}

export async function rollbackLibraryMigration(journal: MigrationJournal, io: MigrationIO): Promise<void> {
  validateJournal(journal);
  if (journal.phase === "rolled-back") return;
  if (journal.pending) throw Error("migration_pending_step_requires_review");
  await verifyExpected(io, journal.expected);
  const current = await io.scan(), tracked = new Set(Object.keys(journal.expected));
  const targets = new Set(journal.plan.items.map(i => i.to));
  if (current.files.some(f => !tracked.has(f.path) && f.links.some(p => targets.has(p)))) throw Error("migration_new_references_require_review");
  const moved = journal.plan.items.slice(0, journal.step).filter(i => i.from !== i.to).reverse();
  journal.phase = "rollback"; journal.rollbackStep ||= 0; await io.saveJournal(journal);
  while (journal.rollbackStep < moved.length) {
    const item = moved[journal.rollbackStep];
    await step(io, journal, `rollback:${item.id}`, async () => { await io.rename(item.to, item.from); journal.rollbackStep!++; });
  }
  for (const [path, content] of Object.entries(journal.before)) {
    if (content === null) continue;
    const current = await io.read(path);
    if (current !== content) {
      if (current === null) throw Error(`migration_rollback_missing: ${path}`);
      await step(io, journal, `restore:${path}`, () => io.write(path, content, hash(current)));
    }
  }
  await io.syncIndex(); journal.phase = "rolled-back"; await io.saveJournal(journal);
}

export function migrationPreviewMarkdown(plan: MigrationPlan): string {
  return `# TSNotes library migration preview\n\nDigest: \`${plan.digest}\`\n\nVideos: ${plan.counts.videos}; Playlists: ${plan.counts.playlists}; affected files outside root: ${plan.counts.externalReferences}.\n\n${plan.errors.length ? "## Conflicts\n" + plan.errors.map(e => "- " + e).join("\n") : "No identity or filename conflicts."}\n\n## Paths\n\n` + plan.items.map(i => `- ${i.kind}: ${i.from}\n  → ${i.to}`).join("\n") + "\n\n## All backed-up / checked paths\n\n" + Object.keys(plan.expected).map(p => "- " + p).join("\n") + "\n\nOnly confirmed empty old folders may be moved to Obsidian Trash. No video body is generated or replaced.\n";
}
