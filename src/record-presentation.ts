import type { App, TFile, WorkspaceContainer, WorkspaceLeaf, WorkspaceTabs } from "obsidian";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export type RecordOpenMode = "window" | "tab";
export function recordOpenMode(value: unknown): RecordOpenMode { return value === "tab" ? "tab" : "window"; }
export interface PresentationStore { read(): Promise<string | null>; write(id: string): Promise<void> }

/** Device-local identity only; never write workspace layout or note properties. */
export function presentationStore(vaultId: string, directory = join(homedir(), "Library", "Application Support", "TSNotes Bridge Peng")): PresentationStore {
  if (!/^[a-f0-9-]{36}$/i.test(vaultId)) throw Error("invalid_vault_identity");
  const file = join(directory, vaultId + ".presentation.json");
  let corrupt = false;
  return {
    async read() {
      let raw: string;
      try { raw = await readFile(file, "utf8"); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw Error("presentation_state_unavailable"); }
      try {
        const data = JSON.parse(raw);
        if (data.version !== 1 || typeof data.windowLayoutId !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(data.windowLayoutId)) throw Error();
        return data.windowLayoutId;
      } catch { corrupt = true; return null; }
    },
    async write(windowLayoutId) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (corrupt) { await copyFile(file, file + ".corrupt-" + randomUUID()); corrupt = false; }
      const tmp = file + ".tmp-" + randomUUID();
      await writeFile(tmp, JSON.stringify({ version: 1, windowLayoutId }), { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}

type LayoutNode = { id: string; type: string; children?: LayoutNode[] };
function node(value: unknown): LayoutNode {
  if (!value || typeof value !== "object") throw Error("unsupported_workspace_layout");
  const v = value as LayoutNode;
  if (typeof v.id !== "string" || typeof v.type !== "string" || (v.children !== undefined && !Array.isArray(v.children))) throw Error("unsupported_workspace_layout");
  return v;
}
function leafIds(value: unknown, depth = 0): string[] {
  if (depth > 32) throw Error("unsupported_workspace_layout");
  const n = node(value);
  return n.type === "leaf" ? [n.id] : (n.children || []).flatMap(c => leafIds(c, depth + 1));
}

/** Narrow adapter for the public getLayout() result. IDs are never inferred from titles. */
function floatingWindows(app: App): LayoutNode[] {
  const layout = app.workspace.getLayout();
  if (layout.floating == null) return [];
  const floating = node(layout.floating);
  if (floating.type !== "floating") throw Error("unsupported_workspace_layout");
  return (floating.children || []).map(node).filter(n => n.type === "window");
}

export class RecordPresentation {
  private active = true;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = new Map<string, Promise<void>>();
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private identity: Promise<void>;
  private windowId: string | null = null;
  private managed: WorkspaceContainer | null = null;
  private group: WorkspaceTabs | null = null;
  private identityDirty = false;
  private openingLeaf: WorkspaceLeaf | null = null;

  constructor(private app: App, private mode: () => unknown, private store: PresentationStore) {
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
    app.workspace.onLayoutReady(() => this.resolveReady());
    // Keep a rejected load observable by the next operation, without an unhandled rejection.
    this.identity = store.read().then(id => { this.windowId = id; });
    void this.identity.catch(() => undefined);
  }
  private assertActive(): void { if (!this.active) throw Error("presentation_stopped"); }
  private leaves(): WorkspaceLeaf[] {
    const result: WorkspaceLeaf[] = [];
    this.app.workspace.iterateAllLeaves(l => { result.push(l); });
    return result;
  }
  private inContainer(container: WorkspaceContainer): WorkspaceLeaf[] {
    return this.leaves().filter(l => l.getContainer() === container && (container !== this.app.workspace.rootSplit || l.getRoot() === container));
  }
  private live(container: WorkspaceContainer | null): container is WorkspaceContainer {
    return !!container?.win && !container.win.closed && this.inContainer(container).length > 0;
  }
  private restore(): WorkspaceContainer | null {
    if (!this.windowId) return null;
    const window = floatingWindows(this.app).find(n => n.id === this.windowId);
    if (!window) return null;
    const leaves = leafIds(window).map(id => this.app.workspace.getLeafById(id)).filter((l): l is WorkspaceLeaf => !!l);
    const container = leaves[0]?.getContainer();
    if (!container) return null;
    if (container === this.app.workspace.rootSplit || !this.live(container)) {
      // A restored window's layout may precede its renderer document as well.
      this.openingLeaf = leaves[0];
      return null;
    }
    if (leaves.some(l => l.getContainer() !== container)) return null;
    return container;
  }
  private async window(): Promise<WorkspaceContainer> {
    if (this.openingLeaf && !floatingWindows(this.app).some(n => leafIds(n).some(id => this.app.workspace.getLeafById(id) === this.openingLeaf))) this.openingLeaf = null;
    if (!this.openingLeaf && !this.live(this.managed)) { this.managed = this.restore(); this.group = null; }
    if (!this.openingLeaf && !this.managed) {
      floatingWindows(this.app);
      this.openingLeaf = this.app.workspace.openPopoutLeaf();
      this.windowId = null;
      this.identityDirty = true;
    }
    if (this.openingLeaf) {
      // Until Electron attaches the new document, getContainer() temporarily
      // reports the main window. Re-read it rather than caching that value.
      const leaf = this.openingLeaf, deadline = Date.now() + 5000;
      let container = leaf.getContainer();
      while ((container === this.app.workspace.rootSplit || !this.live(container)) && Date.now() < deadline) {
        this.assertActive();
        await new Promise(resolve => setTimeout(resolve, 25));
        container = leaf.getContainer();
      }
      this.assertActive();
      if (container === this.app.workspace.rootSplit || !this.live(container)) throw Error("presentation_window_unavailable");
      this.managed = container;
      this.group = leaf.parent as WorkspaceTabs;
      this.openingLeaf = null;
    }
    if (this.identityDirty) {
      const container = this.managed;
      const window = floatingWindows(this.app).find(n => leafIds(n).some(id => this.app.workspace.getLeafById(id)?.getContainer() === container));
      if (!window) throw Error("presentation_window_identity_unavailable");
      this.windowId = window.id;
      await this.store.write(this.windowId);
      this.identityDirty = false;
      this.assertActive();
      this.app.workspace.requestSaveLayout();
    }
    if (!this.managed) throw Error("presentation_window_unavailable");
    return this.managed;
  }
  open(file: TFile): Promise<void> {
    const mode = recordOpenMode(this.mode()), key = mode + ":" + file.path;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.tail.catch(() => undefined).then(async () => {
      this.assertActive(); await this.ready; if (mode === "window") await this.identity; this.assertActive();
      const container = mode === "window" ? await this.window() : this.app.workspace.rootSplit;
      this.assertActive();
      const leaves = this.inContainer(container);
      let target = leaves.find(l => l.getViewState().type === "markdown" && l.getViewState().state?.file === file.path);
      if (target) {
        await this.app.workspace.revealLeaf(target);
        this.assertActive();
        if (!this.inContainer(container).includes(target)) throw Error("presentation_target_changed");
      } else {
        const anchor = (mode === "window" && leaves.find(l => l.parent === this.group)) || leaves[0];
        if (!anchor) throw Error("presentation_tab_group_unavailable");
        const before = new Set(this.leaves());
        this.app.workspace.setActiveLeaf(anchor, { focus: false });
        target = this.app.workspace.getLeaf("tab");
        const empty = target.getViewState().type === "empty";
        if (target.getContainer() !== container || !empty) {
          if (!before.has(target) && empty) target.detach();
          throw Error("presentation_wrong_container");
        }
        this.assertActive();
        await target.openFile(file, { active: true });
        this.assertActive();
        if (target.getContainer() !== container || target.getViewState().state?.file !== file.path) throw Error("presentation_target_changed");
        await this.app.workspace.revealLeaf(target);
      }
      this.assertActive();
      if (mode === "window") this.group = target.parent as WorkspaceTabs;
    });
    this.pending.set(key, task);
    this.tail = task;
    void task.finally(() => { if (this.pending.get(key) === task) this.pending.delete(key); }).catch(() => undefined);
    return task;
  }
  layoutChanged(): void {
    if (!this.live(this.managed)) { this.managed = null; this.group = null; }
  }
  dispose(): void { this.active = false; this.resolveReady(); this.managed = null; this.group = null; }
}
