import { EditorView } from "@codemirror/view";
import { linkAt, eventElement } from "./link-target";
import { RecordService } from "./records";
import { storageFor } from "./obsidian-storage";
import { defaults, registry, safePath, type BridgeSettings } from "./model";
import {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  FileSystemAdapter,
  TFile,
} from "obsidian";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BridgeServer } from "./server";
import { loadLocalState, type LocalState } from "./local-state";
import { addLaunchMarker } from "./launch-url";
const run = promisify(execFile);
export default class TSNotesBridgePlugin extends Plugin {
  records!: RecordService;
  settings: BridgeSettings = structuredClone(defaults);
  bridge!: BridgeServer;
  local!: LocalState;
  saveLocal!: () => Promise<void>;
  private launchInFlight: Promise<void> | null = null;
  private lastClick = "";
  private lastAt = 0;
  private clickSequence = 0;
  private launchTimer: ReturnType<typeof setInterval> | null = null;
  private cancelLaunch: (() => void) | null = null;
  async onload(): Promise<void> {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter))
      throw Error("desktop_vault_required");
    const saved = await this.loadData();
    this.settings = { ...defaults, ...saved, fields: saved?.fields || {} };
    const local = await loadLocalState(
      this.app.vault.adapter.getBasePath(),
      this.settings.vaultId,
    );
    this.local = local.state;
    this.saveLocal = local.save;
    if (this.settings.vaultId !== this.local.vaultId) {
      this.settings.vaultId = this.local.vaultId;
      await this.saveData(this.settings);
    }
    safePath(this.settings.root);
    safePath(this.settings.videos);
    safePath(this.settings.playlists);
    this.records = new RecordService(storageFor(this.app), () => this.settings);
    const index = (file: TFile) => {
      const props = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (props)
        this.records.index.set({ path: file.path, props: { ...props } });
      else this.records.index.invalidate(file.path);
    };
    let initialized = false,
      resolveIndex: () => void = () => {};
    const indexReady = new Promise<void>((resolve) => {
      resolveIndex = resolve;
    });
    const initialize = () => {
      if (initialized) return;
      const files = this.app.vault.getMarkdownFiles();
      if (files.some((f) => !this.app.metadataCache.getFileCache(f))) return;
      for (const file of files) index(file);
      initialized = true;
      resolveIndex();
    };
    this.app.workspace.onLayoutReady(initialize);
    this.registerEvent(this.app.metadataCache.on("resolved", initialize));
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => index(file)),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, old) => {
        const entry = this.records.index.entries.get(old);
        this.records.index.remove(old);
        if (file instanceof TFile && entry) {
          this.records.index.set({ path: file.path, props: entry.props });
          void this.records
            .reconcileLinks()
            .catch((e) => new Notice("TSNotes: " + e.message));
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) =>
        this.records.index.remove(file.path),
      ),
    );
    this.bridge = new BridgeServer(this.local, this.saveLocal, async (r) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("metadata_index_not_ready")),
          10000,
        );
        indexReady.then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      if (r.action === "ensure")
        return this.records.ensure(r.payload.record, r.payload.open !== false);
      if (r.action === "find") {
        const entry = await this.records.find(r.payload.record);
        return entry
          ? { documentId: entry.props.TSNotesID, path: entry.path }
          : null;
      }
      if (r.action === "refresh")
        return this.records.refresh(
          r.payload.record,
          r.payload.apply === true,
          r.payload.expected as
            { documentId?: unknown; changes?: unknown } | undefined,
        );
      if (r.action === "open")
        return this.records.open(String(r.payload.documentId || ""));
      throw Error("unsupported_operation");
    });
    await this.bridge.start();
    this.register(() => {
      this.bridge.stop();
      this.cancelLaunch?.();
      if (this.launchTimer) clearInterval(this.launchTimer);
    });
    this.addSettingTab(new BridgeSettingTab(this));
    this.addCommand({
      id: "copy-pairing",
      name: "Copy local pairing data",
      callback: () => {
        void this.copyPairing();
      },
    });
    const documents = new Map<Document, (event: MouseEvent) => void>();
    const unbind = (doc: Document) => {
      const listener = documents.get(doc);
      if (listener) doc.removeEventListener("click", listener, true);
      documents.delete(doc);
    };
    const bind = (doc: Document) => {
      if (documents.has(doc)) return;
      const listener = (event: MouseEvent) => {
        const target = eventElement(event.target);
        const anchor = target?.closest("a[href],.external-link[data-href]");
        const href =
          anchor?.getAttribute("href") || anchor?.getAttribute("data-href");
        if (href && this.isTsnotes(href)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void this.play(href).catch(
            (e) => new Notice("TSNotes: " + e.message),
          );
        }
      };
      documents.set(doc, listener);
      doc.addEventListener("click", listener, true);
    };
    this.register(() => {
      for (const doc of documents.keys()) unbind(doc);
    });
    this.registerEditorExtension(
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (event.button !== 0) return false;
          const target = event.target as HTMLElement;
          if (
            !event.metaKey &&
            !event.ctrlKey &&
            !target.closest(".cm-link,.cm-url,.cm-hmd-external-link")
          )
            return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos == null) return false;
          const line = view.state.doc.lineAt(pos),
            href = linkAt(line.text, pos - line.from);
          if (!href || !this.isTsnotes(href)) return false;
          event.preventDefault();
          event.stopImmediatePropagation();
          void this.play(href).catch(
            (e) => new Notice("TSNotes: " + e.message),
          );
          return true;
        },
      }),
    );
    bind(document);
    this.app.workspace.iterateAllLeaves((leaf) =>
      bind(leaf.view.containerEl.ownerDocument),
    );
    this.registerEvent(
      this.app.workspace.on("window-open", (_window, win) =>
        bind(win.document),
      ),
    );
    this.registerEvent(
      this.app.workspace.on("window-close", (_window, win) =>
        unbind(win.document),
      ),
    );
  }
  isTsnotes(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.searchParams.get("type")?.toLowerCase() === "tsnotes" &&
        [
          "www.youtube.com",
          "youtube.com",
          "youtu.be",
          "m.youtube.com",
          "m.bilibili.com",
          "www.bilibili.com",
          "bilibili.com",
          "pan.baidu.com",
        ].includes(parsed.hostname)
      );
    } catch {
      return false;
    }
  }
  async copyPairing(): Promise<void> {
    await navigator.clipboard.writeText(
      JSON.stringify({
        protocolVersion: "1.0",
        vaultId: this.local.vaultId,
        vaultName: this.app.vault.getName(),
        port: this.local.port,
        secret: this.local.secret,
      }),
    );
    new Notice("已复制本机配对信息，请粘贴到 TSNotes Obsidian 配对页面。");
  }
  async play(url: string): Promise<void> {
    if (!this.isTsnotes(url)) throw Error("unsupported_play_url");
    if (this.lastClick === url && Date.now() - this.lastAt < 500) return;
    this.lastClick = url;
    this.lastAt = Date.now();
    const sequence = ++this.clickSequence;
    if (this.launchInFlight) {
      await this.launchInFlight;
      if (sequence !== this.clickSequence) return;
      if (!this.bridge.connected) throw Error("launch_not_connected");
      const result = (await this.bridge.play(url)) as {
        success?: boolean;
        reason?: string; reasonCode?: string;
      };
      if (!result?.success) throw Error(result?.reason || result?.reasonCode || "play_failed");
      return;
    }
    if (this.bridge.connected) {
      const result = (await this.bridge.play(url)) as {
        success?: boolean;
        reason?: string; reasonCode?: string;
      };
      if (!result?.success) throw Error(result?.reason || result?.reasonCode || "play_failed");
      new Notice("TSNotes 已发送播放定位");
      return;
    }
    const ticket = this.bridge.ticket(url),
      marked = addLaunchMarker(url, this.local.vaultId, ticket);
    this.launchInFlight = (async () => {
      await run("/usr/bin/open", ["-b", this.local.browserBundle, marked], {
        timeout: 10000,
      });
      await new Promise<void>((resolve, reject) => {
        const started = Date.now();
        let receipt: {success:boolean;reason:string}|null=null;
        const timer = setInterval(() => {
          receipt ||= this.bridge.takeLaunchResult(ticket);
          if (receipt && (!receipt.success || this.bridge.connected)) {
            clearInterval(timer);
            this.launchTimer = null;
            this.cancelLaunch = null;
            if(receipt.success)resolve();
            else reject(Error(receipt.reason));
          } else if (Date.now() - started > 30000) {
            clearInterval(timer);
            this.launchTimer = null;
            this.cancelLaunch = null;
            reject(Error("launch_timeout_check_browser_profile"));
          }
        }, 250);
        this.launchTimer = timer;
        this.cancelLaunch = () => reject(Error("plugin_unloaded"));
      });
    })();
    try {
      await this.launchInFlight;
      new Notice("VideoPlay 已连接");
    } finally {
      this.launchInFlight = null;
    }
  }
}
class BridgeSettingTab extends PluginSettingTab {
  constructor(private plugin: TSNotesBridgePlugin) {
    super(plugin.app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TSNotes Bridge Peng" });
    new Setting(containerEl)
      .setName("本机连接")
      .setDesc(
        `Vault ${this.plugin.local.vaultId} · 127.0.0.1:${this.plugin.local.port} · ${this.plugin.bridge.connected ? "VideoPlay 在线" : "按操作连接"}`,
      );
    new Setting(containerEl)
      .setName("配对浏览器扩展")
      .setDesc("配对信息仅在本机使用，含访问密钥，请勿发布。")
      .addButton((b) =>
        b
          .setButtonText("复制配对信息")
          .onClick(() => this.plugin.copyPairing()),
      );
    for (const [key, label] of [
      ["root", "保存根目录"],
      ["videos", "单视频子目录"],
      ["playlists", "Playlist 子目录"],
    ] as const)
      new Setting(containerEl)
        .setName(label)
        .setDesc("仅影响新记录；已有记录保持原位置。")
        .addText((t) =>
          t.setValue(this.plugin.settings[key]).onChange(async (value) => {
            try {
              safePath(value);
              this.plugin.settings[key] = value;
              await this.plugin.saveData(this.plugin.settings);
            } catch {
              new Notice("请输入有效的 Vault 相对目录");
            }
          }),
        );
    containerEl.createEl("h3", { text: "Properties" });
    containerEl.createEl("p", {
      text: "核心身份字段固定保留。修改字段名称只影响新记录及之后的显式刷新，不迁移历史笔记。",
    });
    for (const [key, base] of Object.entries(registry)) {
      const rule = { ...base, ...this.plugin.settings.fields[key] };
      const save = async () => {
        this.plugin.settings.fields[key] = { ...rule };
        await this.plugin.saveData(this.plugin.settings);
      };
      new Setting(containerEl)
        .setName(base.name + " · " + base.records)
        .addToggle((t) =>
          t
            .setValue(rule.enabled)
            .setTooltip("创建时包含")
            .onChange(async (v) => {
              rule.enabled = v;
              await save();
            }),
        )
        .addText((t) =>
          t.setValue(rule.name).onChange(async (v) => {
            rule.name = v;
            await save();
          }),
        )
        .addDropdown((d) =>
          d
            .addOptions({
              text: "文本",
              number: "数字",
              list: "列表",
              date: "日期",
            })
            .setValue(rule.type)
            .onChange(async (v) => {
              rule.type = v as typeof rule.type;
              await save();
            }),
        )
        .addToggle((t) =>
          t
            .setValue(rule.refresh)
            .setTooltip("允许显式刷新")
            .onChange(async (v) => {
              rule.refresh = v;
              await save();
            }),
        );
    }
    new Setting(containerEl)
      .setName("启动浏览器")
      .setDesc("必须与安装 TSNotes 的浏览器一致。")
      .addDropdown((d) =>
        d
          .addOptions({
            "com.citrolabs.ego.lite": "ego lite",
            "com.microsoft.edgemac": "Microsoft Edge",
            "com.google.Chrome": "Google Chrome",
          })
          .setValue(this.plugin.local.browserBundle)
          .onChange(async (value) => {
            this.plugin.local.browserBundle = value;
            await this.plugin.saveLocal();
          }),
      );
  }
}
