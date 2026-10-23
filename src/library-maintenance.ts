import { App, MarkdownView, TFile, TFolder, parseYaml } from "obsidian";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { RecordService } from "./records";
import { safePath, text, type BridgeSettings, type Fields } from "./model";
import { libraryViews, type LibraryView } from "./library";
import { beginLibraryMigration, hash, migrationPreviewMarkdown, planLibraryMigration, rollbackLibraryMigration, runLibraryMigration, type MigrationIO, type MigrationJournal, type MigrationPlan, type MigrationSnapshot } from "./library-migration";

export interface ViewChange extends LibraryView { beforeHash: string | null; changed: boolean; }
export class LibraryMaintenance {
  readonly backupRoot: string;
  private active = true;
  deactivate(): void { this.active = false; }
  private assertActive(): void { if (!this.active) throw Error("migration_plugin_unloaded"); }
  constructor(private app: App, private records: RecordService, private settings: () => BridgeSettings, vaultId: string, private configPath: string) {
    if (!/^[a-f0-9-]{36}$/.test(vaultId)) throw Error("invalid_vault_id");
    safePath(configPath.replace(/^\.[^/]+\//, "config/"));
    this.backupRoot = join(homedir(), "Library", "Application Support", "TSNotes Bridge Peng", "migrations", vaultId);
  }
  private props(content: string): Fields {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return {};
    const value = parseYaml(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_frontmatter");
    return value;
  }
  private async read(path: string): Promise<string | null> {
    this.validatePath(path);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return this.app.vault.read(file);
    if (file) throw Error(`expected_file: ${path}`);
    return await this.app.vault.adapter.exists(path) ? this.app.vault.adapter.read(path) : null;
  }
  private validatePath(path: string): void {
    if (path !== this.configPath) safePath(path);
  }
  private async directory(path: string): Promise<void> {
    let parent = "";
    for (const part of safePath(path).split("/")) {
      parent = parent ? parent + "/" + part : part;
      const existing = this.app.vault.getAbstractFileByPath(parent);
      if (existing && !(existing instanceof TFolder)) throw Error(`directory_conflict: ${parent}`);
      if (!existing) await this.app.vault.createFolder(parent);
    }
  }
  private async scan(): Promise<MigrationSnapshot> {
    const snapshot: MigrationSnapshot = { files: [], extras: {}, issues: [], occupiedPaths: this.app.vault.getAllLoadedFiles().map(f => f.path) };
    for (const file of this.app.vault.getFiles()) {
      if (!["md", "base", "canvas"].includes(file.extension)) continue;
      const content = await this.app.vault.read(file);
      let props: Fields | undefined;
      if (file.extension === "md") {
        try { props = this.props(content); }
        catch { if (/TSNotesID|Record Type:/.test(content)) snapshot.issues!.push(`Invalid YAML: ${file.path}`); }
      }
      snapshot.files.push({ path: file.path, content, props, links: Object.keys(this.app.metadataCache.resolvedLinks[file.path] || {}) });
      if (props?.["Record Type"] === "playlist") {
        const path = text(props["Relations Path"]);
        if (!/\/_data\/playlists\/[a-f0-9-]{36}\.json$/.test(path)) snapshot.issues!.push(`Invalid relationship path: ${file.path}`);
        else { const raw = await this.read(path); if (raw !== null) snapshot.extras[path] = raw; }
      }
    }
    const config = await this.read(this.configPath);
    if (config !== null) snapshot.extras[this.configPath] = config;
    return snapshot;
  }
  private async assertNoDrafts(paths: string[]): Promise<void> {
    const selected = new Set(paths), views: MarkdownView[] = [];
    this.app.workspace.iterateAllLeaves(leaf => { if (leaf.view instanceof MarkdownView && leaf.view.file && selected.has(leaf.view.file.path)) views.push(leaf.view); });
    for (const view of views) if (view.file && view.getMode() === "source" && view.editor.getValue() !== await this.app.vault.read(view.file)) throw Error(`unsaved_editor: ${view.file.path}`);
  }
  private async atomicLocal(path: string, content: string): Promise<void> {
    await mkdir(this.backupRoot, { recursive: true, mode: 0o700 });
    const temporary = path + "." + randomUUID() + ".tmp";
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  }
  private async saveJournal(journal: MigrationJournal): Promise<void> {
    if (!/^[a-f0-9-]{36}$/.test(journal.id)) throw Error("invalid_migration_id");
    await this.atomicLocal(join(this.backupRoot, journal.id + ".journal.json"), JSON.stringify(journal, null, 2));
    await this.atomicLocal(join(this.backupRoot, "latest.json"), JSON.stringify({ id: journal.id }));
  }
  private io(allowed?: Set<string>): MigrationIO {
    return {
      validatePath: path => this.validatePath(path),
      scan: () => this.scan(), read: path => this.read(path), props: raw => this.props(raw),
      assertNoDrafts: paths => this.assertNoDrafts(paths),
      rename: async (from, to) => {
        this.assertActive();
        safePath(from); safePath(to);
        if (allowed && Object.entries(this.app.metadataCache.resolvedLinks).some(([path, links]) => links[from] && !allowed.has(path))) throw Error("migration_new_references_require_review");
        const file = this.app.vault.getAbstractFileByPath(from);
        if (!(file instanceof TFile)) throw Error(`migration_document_missing: ${from}`);
        if (this.app.vault.getAbstractFileByPath(to)) throw Error(`migration_destination_exists: ${to}`);
        await this.directory(to.slice(0, to.lastIndexOf("/")));
        await this.app.fileManager.renameFile(file, to);
      },
      write: async (path, content, expectedHash) => {
        this.assertActive();
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw Error(`migration_document_missing: ${path}`);
        await this.app.vault.process(file, current => { if (hash(current) !== expectedHash) throw Error(`migration_file_changed: ${path}`); return content; });
      },
      reconcile: paths => this.records.reconcileDuringMaintenance(paths),
      trashEmpty: async path => {
        this.assertActive();
        const folder = this.app.vault.getAbstractFileByPath(safePath(path));
        if (folder instanceof TFolder && folder.children.length === 0 && (await this.app.vault.adapter.list(path)).files.length === 0 && (await this.app.vault.adapter.list(path)).folders.length === 0) await this.app.fileManager.trashFile(folder);
      },
      saveJournal: journal => this.saveJournal(journal),
      syncIndex: async () => {
        for (const path of [...this.records.index.entries.keys()]) this.records.index.remove(path);
        for (const file of (await this.scan()).files) if (file.props) this.records.index.set({ path: file.path, props: file.props });
      },
    };
  }
  async preview(): Promise<MigrationPlan> {
    const plan = planLibraryMigration(await this.scan(), this.settings());
    await this.assertNoDrafts(Object.keys(plan.expected));
    return plan;
  }
  async exportPreview(plan: MigrationPlan): Promise<string> {
    await this.atomicLocal(join(this.backupRoot, plan.id + ".preview.json"), JSON.stringify(plan, null, 2));
    const path = join(this.backupRoot, plan.id + ".preview.md");
    await this.atomicLocal(path, migrationPreviewMarkdown(plan)); return path;
  }
  async apply(plan: MigrationPlan, confirmedDigest: string): Promise<MigrationJournal> {
    if (JSON.stringify(this.settings()) !== JSON.stringify(plan.settings)) throw Error("migration_settings_changed");
    return this.records.maintain(async () => {
      const io = this.io(new Set(Object.keys(plan.expected)));
      const journal = await beginLibraryMigration(plan, confirmedDigest, io);
      await runLibraryMigration(journal, io); return journal;
    });
  }
  async latest(): Promise<MigrationJournal> {
    const { id } = JSON.parse(await readFile(join(this.backupRoot, "latest.json"), "utf8"));
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) throw Error("invalid_migration_id");
    const journal = JSON.parse(await readFile(join(this.backupRoot, id + ".journal.json"), "utf8")) as MigrationJournal;
    if (journal.id !== id || journal.version !== 1 || journal.plan.settings.vaultId !== this.settings().vaultId) throw Error("migration_journal_conflict");
    return journal;
  }
  async resume(journal: MigrationJournal): Promise<void> {
    if (JSON.stringify(this.settings()) !== JSON.stringify(journal.plan.settings)) throw Error("migration_settings_changed");
    await this.records.maintain(() => runLibraryMigration(journal, this.io(new Set(Object.keys(journal.expected)))));
  }
  async rollback(journal: MigrationJournal): Promise<void> {
    await this.records.maintain(() => rollbackLibraryMigration(journal, this.io(new Set(Object.keys(journal.expected)))));
  }
  async viewPreview(): Promise<ViewChange[]> {
    const changes: ViewChange[] = [];
    for (const view of libraryViews(this.settings())) { const before = await this.read(view.path); changes.push({ ...view, beforeHash: before === null ? null : hash(before), changed: before !== view.content }); }
    return changes;
  }
  async applyViews(changes: ViewChange[]): Promise<void> {
    await this.records.maintain(async () => {
      await this.assertNoDrafts(changes.map(c => c.path));
      const valid = libraryViews(this.settings());
      for (const change of changes) {
        if (!valid.some(v => v.path === change.path && v.content === change.content)) throw Error("library_view_preview_stale");
        const before = await this.read(change.path);
        if ((before === null ? null : hash(before)) !== change.beforeHash) throw Error("library_view_changed");
      }
      const backup = { version: 1, createdAt: new Date().toISOString(), files: await Promise.all(changes.map(async c => ({ path: c.path, content: await this.read(c.path) }))) };
      await this.atomicLocal(join(this.backupRoot, randomUUID() + ".views-backup.json"), JSON.stringify(backup, null, 2));
      for (const change of changes) {
        if (change.beforeHash === null) { await this.directory(change.path.slice(0, change.path.lastIndexOf("/"))); await this.app.vault.create(change.path, change.content); }
        else await this.io().write(change.path, change.content, change.beforeHash);
      }
    });
  }
}
