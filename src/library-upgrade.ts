import {App, MarkdownView, TFile, TFolder, parseYaml} from "obsidian";
import {mkdir, readFile, writeFile, rename, access} from "node:fs/promises";
import {join} from "node:path";
import {homedir} from "node:os";
import {randomUUID} from "node:crypto";
import type {BridgeSettings} from "./model";
import type {RecordService} from "./records";
import type {ResourceService} from "./resources";
import {libraryPaths} from "./library";
import {nativePropertyTypes, isUUID} from "./property-rules";
import {canonicalContent, contentHash, finalPath, obsoleteBaseReferences, propertyChanges, durationDiscrepancy, splitNote, transformUpgradeContent, upgradeRoots, type MovedFile, type PropertyChange} from "./library-upgrade-content";

interface Entry extends MovedFile {properties?: PropertyChange[]; titleDiffers?: boolean; durationDiffers?: boolean;}
export interface UpgradePreview {
  version: 4; id: string; digest: string; settings: BridgeSettings;
  folders: {from: string; to: string}[]; files: Entry[]; references: string[];
  protectedReferences: string[]; allowedProtected: string[]; issues: string[];
  expected: Record<string, string>; universe: string[];
  types: {name: string; type: string; current?: string; conflicts: string[]}[];
}
interface Pending {kind: "move" | "write" | "rollback-move"; from: string; to?: string; original?: string; afterHash?: string;}
export interface UpgradeJournal {
  version: 4; id: string; plan: UpgradePreview; phase: "moving" | "writing" | "complete" | "rollback" | "rolled-back";
  before: Record<string, {hash: string; text: boolean}>; expected: Record<string, string>;
  positions: Record<string, string>; moveStep: number; writeStep: number;
  writes: string[]; pending?: Pending; error?: string;
}
const textFile = (path: string) => /\.(md|base|canvas|json)$/.test(path);
const protectedPath = (path: string) => path === "TSNotes QA Retained" || path.startsWith("TSNotes QA Retained/");
export const upgradeDigest = (plan: UpgradePreview): string => {const {digest, ...rest} = plan; return contentHash(JSON.stringify(rest));};

/** Explicit, local-only migration. Backups and journals never enter the Vault. */
export class LibraryUpgrade {
  readonly local: string;
  private active = true;
  private incomplete = false;
  constructor(private app: App, private records: RecordService, private resources: ResourceService, private settings: () => BridgeSettings, vaultId: string, localRoot?: string) {
    if (!isUUID(vaultId)) throw Error("invalid_vault_id");
    this.local = localRoot || join(homedir(), "Library", "Application Support", "TSNotes Bridge Peng", "library-v4", vaultId);
  }
  dispose(): void {this.active = false;}
  async initialize(): Promise<void> {
    try {const j = await this.latest(); this.incomplete = !["complete", "rolled-back"].includes(j.phase);}
    catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.incomplete = true;}
  }
  assertReady(): void {if (!this.active) throw Error("plugin_unloaded"); if (this.incomplete) throw Error("library_migration_incomplete：请恢复或回滚 Library 迁移");}
  private configPath(): string {return `${this.app.vault.configDir}/plugins/tsnotes-bridge-peng/data.json`;}
  private async bytes(path: string): Promise<Buffer> {return Buffer.from(await this.app.vault.adapter.readBinary(path));}
  private async exists(path: string): Promise<boolean> {return this.app.vault.adapter.exists(path);}
  private async atomic(path: string, data: string | Buffer): Promise<void> {
    await mkdir(join(path, ".."), {recursive: true, mode: 0o700});
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, data, {mode: 0o600, flag: "wx"}); await rename(temporary, path);
  }
  private folder(id: string): string {if (!isUUID(id)) throw Error("invalid_migration_id"); return join(this.local, id);}
  private async blob(id: string, bytes: Buffer): Promise<string> {
    const hash = contentHash(bytes), path = join(this.folder(id), "files", hash);
    try {await access(path);} catch {await this.atomic(path, bytes);} return hash;
  }
  private async original(journal: UpgradeJournal, hash: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("invalid_backup_hash");
    const bytes = await readFile(join(this.folder(journal.id), "files", hash));
    if (contentHash(bytes) !== hash) throw Error("migration_backup_damaged"); return bytes;
  }
  private async save(journal: UpgradeJournal): Promise<void> {await this.atomic(join(this.folder(journal.id), "journal.json"), JSON.stringify(journal, null, 2));}
  async latest(): Promise<UpgradeJournal> {
    const id = JSON.parse(await readFile(join(this.local, "latest.json"), "utf8")).id;
    const journal = JSON.parse(await readFile(join(this.folder(id), "journal.json"), "utf8")) as UpgradeJournal;
    this.validate(journal); return journal;
  }
  private validate(journal: UpgradeJournal): void {
    if (journal.version !== 4 || journal.id !== journal.plan.id || journal.plan.digest !== upgradeDigest(journal.plan)) throw Error("migration_journal_conflict");
    if (!["complete", "rolled-back"].includes(journal.phase) && JSON.stringify(journal.plan.settings) !== JSON.stringify(this.settings())) throw Error("migration_settings_changed");
    if (Object.keys(journal.before).some(path => !Object.hasOwn(journal.plan.expected, path)) || Object.keys(journal.before).length !== Object.keys(journal.plan.expected).length) throw Error("migration_journal_conflict");
    const keys = Object.keys(journal.before).sort();
    if (JSON.stringify(Object.keys(journal.expected).sort()) !== JSON.stringify(keys) || JSON.stringify(Object.keys(journal.positions).sort()) !== JSON.stringify(keys) || !Number.isInteger(journal.moveStep) || journal.moveStep < 0 || journal.moveStep > journal.plan.folders.length || !Number.isInteger(journal.writeStep) || journal.writeStep < 0 || journal.writeStep > journal.writes.length) throw Error("migration_journal_conflict");
    for (const original of keys) {
      if (journal.before[original].hash !== journal.plan.expected[original] || !/^[a-f0-9]{64}$/.test(journal.expected[original]) || ![original, finalPath(original, journal.plan.settings)].includes(journal.positions[original])) throw Error("migration_journal_conflict");
    }
    if (journal.writes.some(path => !Object.hasOwn(journal.before, path))) throw Error("migration_journal_conflict");
    if (journal.pending?.kind === "write" && (!journal.pending.original || journal.positions[journal.pending.original] !== journal.pending.from || !/^[a-f0-9]{64}$/.test(journal.pending.afterHash || ""))) throw Error("migration_journal_conflict");
    if (journal.pending && journal.pending.kind !== "write" && !journal.plan.folders.some(move => journal.pending!.kind === "move" ? move.from === journal.pending!.from && move.to === journal.pending!.to : move.to === journal.pending!.from && move.from === journal.pending!.to)) throw Error("migration_journal_conflict");
  }
  async preview(allowedProtected: string[] = [], id: string = randomUUID()): Promise<UpgradePreview> {
    if (!this.active) throw Error("plugin_unloaded");
    const settings = structuredClone(this.settings()), paths = libraryPaths(settings), loaded = this.app.vault.getFiles();
    const folders = upgradeRoots(settings).filter(r => this.app.vault.getAbstractFileByPath(r.from));
    const plan: UpgradePreview = {version: 4, id, digest: "", settings, folders, files: [], references: [], protectedReferences: [], allowedProtected: [...allowedProtected].sort(), issues: [], expected: {}, universe: loaded.map(f => f.path).sort(), types: []};
    const destinations = new Set<string>();
    for (const folder of folders) {
      if (!(this.app.vault.getAbstractFileByPath(folder.from) instanceof TFolder)) plan.issues.push("旧目录不是文件夹：" + folder.from);
      if (this.app.vault.getAbstractFileByPath(folder.to)) plan.issues.push("目标目录已存在：" + folder.to);
      if (folder.to.startsWith(folder.from + "/") || folders.some(other => other.from !== folder.from && folder.from.startsWith(other.from + "/"))) plan.issues.push("保存目录重叠，请先调整配置：" + folder.from);
    }
    const ids = new Map<string, string>();
    for (const file of loaded.filter(f => f.extension === "md" && !folders.some(r => f.path.startsWith(r.from + "/")))) {
      const props = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
      for (const value of [props.TSNotesID, props.ResourceID]) if (isUUID(value)) ids.set(value, file.path);
    }
    const moved = loaded.filter(f => folders.some(r => f.path.startsWith(r.from + "/")));
    const movedSet = new Set(moved.map(f => f.path));
    for (const file of loaded) {
      const inScope = movedSet.has(file.path), isText = textFile(file.path);
      // Guard every text file against unexpected native link rewrites. Binary
      // files outside the moved directories are neither read nor backed up.
      if (!inScope && !isText) continue;
      const bytes = await this.bytes(file.path); plan.expected[file.path] = contentHash(bytes);
      if (inScope) {
        const to = finalPath(file.path, settings), key = to.normalize("NFC").toLowerCase();
        if (destinations.has(key) || loaded.some(f => f.path !== file.path && f.path.normalize("NFC").toLowerCase() === key)) plan.issues.push("目标文件冲突：" + to);
        destinations.add(key);
        const entry: Entry = {from: file.path, to, sha256: contentHash(bytes), text: isText};
        if (file.extension === "md") {
          try {
            const {props} = splitNote(bytes.toString("utf8"));
            const recordId = props.TSNotesID || props.ResourceID;
            if (recordId) {
              if (!isUUID(recordId)) plan.issues.push("无效身份：" + file.path);
              else if (ids.has(recordId)) plan.issues.push("重复身份：" + ids.get(recordId) + " / " + file.path);
              else ids.set(recordId, file.path);
            }
            entry.properties = propertyChanges(bytes.toString("utf8"), file.path, settings);
            entry.titleDiffers = typeof props.Title === "string" && props.Title !== file.basename;
            entry.durationDiffers = durationDiscrepancy(bytes.toString("utf8"), settings);
            if (props["Record Type"] === "playlist") {
              const relationPath = props["Relations Path"];
              if (typeof relationPath !== "string" || !/^.*\/_data\/playlists\/[a-f0-9-]{36}\.json$/i.test(relationPath) || !await this.exists(relationPath)) plan.issues.push("关系文件缺失：" + file.path);
              else {
                const relation = JSON.parse((await this.bytes(relationPath)).toString("utf8"));
                if (relation.version !== 1 || relation.playlistId !== props.TSNotesID || relation.sourceKey !== props.DedupeKey || !Array.isArray(relation.members)) plan.issues.push("关系文件身份冲突：" + file.path);
              }
            }
          } catch {plan.issues.push("YAML 或关系数据损坏：" + file.path);}
        }
        plan.files.push(entry);
      }
      const links = this.app.metadataCache.resolvedLinks[file.path] || {};
      if (!inScope && Object.keys(links).some(target => movedSet.has(target))) {
        plan.references.push(file.path);
        if (protectedPath(file.path)) {plan.protectedReferences.push(file.path); if (!allowedProtected.includes(file.path)) plan.issues.push("受保护引用（未授权更新）：" + file.path);}
      }
      if (file.extension === "base" && (inScope || file.path === paths.videoBase || file.path === paths.playlistBase)) {
        try {for (const reference of obsoleteBaseReferences(bytes.toString("utf8"))) plan.issues.push("自定义 Base 引用已删除属性：" + file.path + " · " + reference);}
        catch {plan.issues.push("Base 语法损坏：" + file.path);}
      }
    }
    // Type configuration is audited only. Changes are made through native UI/CLI.
    const typePath = `${this.app.vault.configDir}/types.json`;
    const nativeTypes = await this.exists(typePath) ? JSON.parse((await this.bytes(typePath)).toString("utf8")).types || {} : {};
    for (const path of [typePath, this.configPath()]) if (await this.exists(path)) plan.expected[path] = contentHash(await this.bytes(path));
    for (const [name, type] of Object.entries(nativePropertyTypes(settings))) {
      const conflicts: string[] = [];
      for (const file of loaded.filter(f => f.extension === "md" && !f.path.startsWith(settings.root + "/"))) {
        const props = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
        for (const [key, value] of Object.entries(props)) if (key.toLowerCase() === name.toLowerCase() && value != null) {
          const valid = type === "multitext" ? Array.isArray(value) : type === "number" ? typeof value === "number" : typeof value === "string";
          if (!valid) conflicts.push(file.path);
        }
      }
      const key = Object.keys(nativeTypes).find(k => k.toLowerCase() === name.toLowerCase());
      plan.types.push({name, type, current: key ? nativeTypes[key] : undefined, conflicts});
    }
    plan.files.sort((a, b) => a.from.localeCompare(b.from)); plan.references.sort();
    plan.digest = upgradeDigest(plan); return plan;
  }
  async exportPreview(plan: UpgradePreview): Promise<string> {
    await this.atomic(join(this.folder(plan.id), "preview.json"), JSON.stringify(plan, null, 2));
    const path = join(this.folder(plan.id), "preview.md");
    await this.atomic(path, `# TSNotes Library v4 迁移预览\n\n摘要：${plan.digest}\n\n移动 ${plan.files.length} 个文件；清理属性 ${plan.files.filter(f => f.properties?.length).length} 篇；标题不同 ${plan.files.filter(f => f.titleDiffers).length} 篇；时长不同 ${plan.files.filter(f => f.durationDiffers).length} 篇。\n\n## 问题\n${plan.issues.join("\n") || "无"}\n\n## 目录\n${plan.folders.map(f => f.from + " → " + f.to).join("\n")}\n\n## 引用\n${plan.references.join("\n") || "无"}\n\n完整文件清单、属性原值、类型审计见同目录 preview.json。\n`); return path;
  }
  private async noDrafts(paths: string[]): Promise<void> {
    const selected = new Set(paths), views: MarkdownView[] = [];
    this.app.workspace.iterateAllLeaves(leaf => {if (leaf.view instanceof MarkdownView && leaf.view.file && selected.has(leaf.view.file.path)) views.push(leaf.view);});
    for (const view of views) if (view.file && view.getMode() === "source" && view.editor.getValue() !== (await this.bytes(view.file.path)).toString("utf8")) throw Error("unsaved_migration_editor: " + view.file.path);
  }
  private async verify(journal: UpgradeJournal): Promise<void> {
    if (!this.active) throw Error("plugin_unloaded"); this.validate(journal);
    for (const [original, hash] of Object.entries(journal.expected)) if (!await this.exists(journal.positions[original]) || contentHash(await this.bytes(journal.positions[original])) !== hash) throw Error("migration_file_changed: " + journal.positions[original]);
    await this.noDrafts(Object.values(journal.positions));
    const allowed = new Set(Object.values(journal.positions));
    for (const file of this.app.vault.getFiles()) if (!allowed.has(file.path) && journal.plan.folders.some(folder => file.path.startsWith(folder.from + "/") || file.path.startsWith(folder.to + "/"))) throw Error("migration_new_file: " + file.path);
    for (const [path, links] of Object.entries(this.app.metadataCache.resolvedLinks)) if (!allowed.has(path) && Object.keys(links).some(t => journal.plan.files.some(f => t === f.from || t === f.to))) throw Error("migration_new_reference: " + path);
  }
  private async directory(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {current = current ? current + "/" + part : part; const file = this.app.vault.getAbstractFileByPath(current); if (file && !(file instanceof TFolder)) throw Error("directory_conflict: " + current); if (!file) await this.app.vault.createFolder(current);}
  }
  private async acceptMove(journal: UpgradeJournal, from: string, to: string): Promise<void> {
    const next = Object.fromEntries(Object.entries(journal.positions).map(([original, current]) => [original, current.startsWith(from + "/") ? to + current.slice(from.length) : current]));
    // Native renames may shorten links or reserialize YAML. Only equivalent
    // link destinations and equivalent frontmatter are accepted as our edits.
    for (const [original, path] of Object.entries(next)) {
      const current = await this.bytes(path), previous = await this.original(journal, journal.expected[original]);
      if (journal.before[original].text && /\.(md|base)$/.test(path)) {
        if (canonicalContent(current.toString("utf8"), path, journal.plan.universe, journal.plan.settings) !== canonicalContent(previous.toString("utf8"), journal.positions[original], journal.plan.universe, journal.plan.settings)) throw Error("unexpected_native_edit: " + path);
      } else if (contentHash(current) !== journal.expected[original]) throw Error("migration_binary_or_data_changed: " + path);
    }
    for (const [original, path] of Object.entries(next)) journal.expected[original] = await this.blob(journal.id, await this.bytes(path));
    journal.positions = next;
  }
  private async finishPending(journal: UpgradeJournal): Promise<void> {
    const pending = journal.pending; if (!pending) return;
    if (pending.kind === "write") {
      const hash = contentHash(await this.bytes(pending.from));
      if (hash === pending.afterHash) journal.expected[pending.original!] = hash;
      else if (hash === journal.expected[pending.original!]) {
        await this.verify(journal);
        const data = await this.original(journal, pending.afterHash!);
        const file = this.app.vault.getAbstractFileByPath(pending.from);
        if (!(file instanceof TFile)) throw Error("migration_write_target_missing");
        await this.app.vault.process(file, current => {if (contentHash(current) !== journal.expected[pending.original!]) throw Error("migration_file_changed"); return data.toString("utf8");});
        journal.expected[pending.original!] = pending.afterHash!;
      } else throw Error("migration_pending_write_changed");
    } else {
      const old = this.app.vault.getAbstractFileByPath(pending.from), next = this.app.vault.getAbstractFileByPath(pending.to!);
      if (old && !next) {
        await this.verify(journal); await this.directory(pending.to!.slice(0, pending.to!.lastIndexOf("/")));
        await this.app.fileManager.renameFile(old, pending.to!);
        // Bounded settling for native backlink rewrites, never a background poll.
        let previous = "";
        for (let attempt = 0; attempt < 10; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const hashes: string[] = [];
          for (const path of Object.values(journal.positions)) {
            const nextPath = path.startsWith(pending.from + "/") ? pending.to! + path.slice(pending.from.length) : path;
            hashes.push(contentHash(await this.bytes(nextPath)));
          }
          const snapshot = hashes.join(":");
          if (snapshot === previous) break;
          previous = snapshot;
        }
      } else if (old || !next) throw Error("migration_pending_move_uncertain");
      await this.acceptMove(journal, pending.from, pending.to!);
    }
    delete journal.pending; await this.save(journal);
  }
  private async put(journal: UpgradeJournal, original: string, next: string): Promise<void> {
    const path = journal.positions[original], current = await this.bytes(path);
    if (next === current.toString("utf8")) return;
    await this.verify(journal);
    journal.pending = {kind: "write", from: path, original, afterHash: await this.blob(journal.id, Buffer.from(next))}; await this.save(journal);
    await this.finishPending(journal);
  }
  private async exclusive<T>(task: () => Promise<T>): Promise<T> {
    return this.records.maintain(async () => {const release = await this.resources.beginMaintenance(); try {return await task();} finally {release();}});
  }
  async apply(plan: UpgradePreview, confirmedDigest: string): Promise<UpgradeJournal> {
    return this.exclusive(async () => {
      if (plan.digest !== confirmedDigest || plan.digest !== upgradeDigest(plan) || plan.issues.length) throw Error("migration_preview_not_confirmed");
      const fresh = await this.preview(plan.allowedProtected, plan.id);
      if (fresh.digest !== plan.digest) throw Error("migration_preview_stale");
      await this.noDrafts(Object.keys(plan.expected));
      const journal: UpgradeJournal = {version: 4, id: plan.id, plan, before: {}, expected: {...plan.expected}, positions: {}, moveStep: 0, writeStep: 0, phase: "moving", writes: []};
      for (const path of Object.keys(plan.expected)) {const data = await this.bytes(path); journal.before[path] = {hash: await this.blob(plan.id, data), text: textFile(path)}; journal.positions[path] = path;}
      const p = libraryPaths(plan.settings);
      journal.writes = [...new Set([...plan.files.filter(f => f.text && /\.(md|base)$/.test(f.from)).map(f => f.from), p.videoBase, p.playlistBase, ...plan.references.filter(path => !protectedPath(path) || plan.allowedProtected.includes(path))])].filter(path => Object.hasOwn(journal.before, path));
      await this.save(journal); await this.atomic(join(this.local, "latest.json"), JSON.stringify({id: journal.id})); this.incomplete = true;
      await this.run(journal); return journal;
    });
  }
  private async run(journal: UpgradeJournal): Promise<void> {
    this.validate(journal);
    if (["complete", "rolled-back"].includes(journal.phase)) return;
    if (journal.phase === "rollback") throw Error("migration_rollback_in_progress");
    try {
      await this.finishPending(journal); await this.verify(journal);
      while (journal.moveStep < journal.plan.folders.length) {
        const move = journal.plan.folders[journal.moveStep];
        // An interrupted move may already have been accepted during recovery.
        if (this.app.vault.getAbstractFileByPath(move.from)) {journal.pending = {kind: "move", ...move}; await this.save(journal); await this.finishPending(journal);}
        else if (!this.app.vault.getAbstractFileByPath(move.to)) throw Error("migration_directory_missing: " + move.from);
        journal.moveStep++; await this.save(journal);
      }
      journal.phase = "writing"; await this.save(journal);
      while (journal.writeStep < journal.writes.length) {
        const original = journal.writes[journal.writeStep], path = journal.positions[original];
        const before = (await this.original(journal, journal.before[original].hash)).toString("utf8"), current = (await this.bytes(path)).toString("utf8");
        await this.put(journal, original, transformUpgradeContent(before, original, current, path, journal.plan.universe, journal.plan.settings));
        journal.writeStep++; await this.save(journal);
      }
      await this.verify(journal);
      for (const file of journal.plan.files) if (/\/_data\/playlists\/.+\.json$/.test(file.from) && journal.expected[file.from] !== journal.before[file.from].hash) throw Error("migration_relationship_bytes_changed");
      await this.syncIndexes();
      // Settings are intentionally unchanged: the v4 path generator and absence
      // of legacy folders are the layout marker, so recovery never depends on a
      // settings snapshot modified by the migration itself.
      journal.phase = "complete"; delete journal.error; await this.save(journal); this.incomplete = false;
    } catch (error) {journal.error = error instanceof Error ? error.message : "migration_failed"; await this.save(journal); throw error;}
  }
  async resume(): Promise<UpgradeJournal> {return this.exclusive(async () => {const journal = await this.latest(); await this.run(journal); return journal;});}
  async rollback(): Promise<UpgradeJournal> {
    return this.exclusive(async () => {
      const journal = await this.latest();
      if (JSON.stringify(journal.plan.settings) !== JSON.stringify(this.settings())) throw Error("migration_settings_changed");
      await this.finishPending(journal); await this.verify(journal);
      if (journal.phase === "rolled-back") return journal;
      this.incomplete = true; journal.phase = "rollback"; await this.save(journal);
      for (const move of [...journal.plan.folders].reverse()) if (this.app.vault.getAbstractFileByPath(move.to)) {
        if (this.app.vault.getAbstractFileByPath(move.from)) throw Error("rollback_destination_exists");
        journal.pending = {kind: "rollback-move", from: move.to, to: move.from}; await this.save(journal); await this.finishPending(journal);
      }
      for (const [original, before] of Object.entries(journal.before)) {
        const bytes = await this.original(journal, before.hash);
        if (contentHash(await this.bytes(journal.positions[original])) === before.hash) continue;
        if (!before.text) throw Error("rollback_binary_changed");
        await this.put(journal, original, bytes.toString("utf8"));
      }
      await this.syncIndexes(); journal.phase = "rolled-back"; await this.save(journal); this.incomplete = false; return journal;
    });
  }
  private async syncIndexes(): Promise<void> {
    for (const path of [...this.records.index.entries.keys()]) this.records.index.remove(path);
    for (const path of [...this.resources.index.entries.keys()]) this.resources.index.remove(path);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const props = splitNote(await this.app.vault.read(file)).props;
      this.records.index.set({path: file.path, props}); this.resources.index.set({path: file.path, props});
    }
  }
}
