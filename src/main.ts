import { RecordPresentation, presentationStore, recordOpenMode } from "./record-presentation";
import { addPlaybackOpen } from "./playback-open";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { EditorView } from "@codemirror/view";
import { linkFromElement, eventElement, captureMarkdown, snapshotInsertion, applyInsertion } from "./link-target";
import { RecordService } from "./records";
import { storageFor, ensureLibraryViews } from "./obsidian-storage";
import { libraryPaths } from "./library";
import { LibraryMaintenance } from "./library-maintenance";
import { MigrationPreviewModal, MigrationRecoveryModal, showViewReview } from "./library-modals";
import { defaults, registry, safePath, type BridgeSettings } from "./model";
import {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Modal,
  FileSystemAdapter,
  TFile,
  type App,
  type Editor,
  type MarkdownFileInfo,
  type MarkdownView,
} from "obsidian";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BridgeServer } from "./server";
import { loadLocalState, type LocalState } from "./local-state";
const run = promisify(execFile);
export default class TSNotesBridgePlugin extends Plugin {
  records!: RecordService;
  presentation!: RecordPresentation;
  maintenance!: LibraryMaintenance;
  private indexReady: Promise<void> = Promise.resolve();
  settings: BridgeSettings = structuredClone(defaults);
  bridge!: BridgeServer;
  local!: LocalState;
  saveLocal!: () => Promise<void>;
  private launchInFlight: Promise<void> | null = null;
  private lastClick = "";
  private lastAt = 0;
  private clickSequence = 0;
  private launchTimer: ReturnType<typeof setInterval> | null = null;
  private captureBusy = false;
  private active = true;
  private targetEpoch = 0;
  private editorEpoch = 0;
  private cancelLaunch: (() => void) | null = null;
  async onload(): Promise<void> {
    if (!(this.app.vault.adapter instanceof FileSystemAdapter))
      throw Error("desktop_vault_required");
    const saved = await this.loadData();
    this.settings = { ...defaults, ...saved, fields: saved?.fields || {} };
    this.settings.recordOpenMode = recordOpenMode(saved?.recordOpenMode);
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
    this.presentation = new RecordPresentation(this.app, () => this.settings.recordOpenMode, presentationStore(this.local.vaultId));
    this.register(() => this.presentation.dispose());
    this.registerEvent(this.app.workspace.on("layout-change", () => this.presentation.layoutChanged()));
    this.registerEvent(this.app.workspace.on("window-close", () => this.presentation.layoutChanged()));
    this.records = new RecordService(storageFor(this.app, this.presentation), () => this.settings);
    this.maintenance = new LibraryMaintenance(this.app, this.records, () => this.settings, this.local.vaultId, `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`);
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
    this.indexReady = indexReady;
    const initialize = () => {
      if (initialized) return;
      const files = this.app.vault.getMarkdownFiles();
      if (files.some((f) => !this.app.metadataCache.getFileCache(f))) return;
      for (const file of files) index(file);
      initialized = true;
      resolveIndex();
      void ensureLibraryViews(this.app, this.settings).catch(e => new Notice("TSNotes 库视图未初始化：" + e.message));
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
          if (!this.records.maintenanceActive) void this.records
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
    const playbackLog=join(homedir(),"Library","Application Support","TSNotes Bridge Peng",this.local.vaultId+".playback.json");
    let logTail:Promise<unknown>=Promise.resolve();
    try{const previous=JSON.parse(await readFile(playbackLog,"utf8"));if(Array.isArray(previous))this.bridge.playback.loadHistory(previous);}catch{/* No diagnostics yet. */}
    this.bridge.playback.setPersistence(records=>{logTail=logTail.catch(()=>undefined).then(async()=>{await writeFile(playbackLog+".tmp",JSON.stringify(records),{mode:0o600});await rename(playbackLog+".tmp",playbackLog);}).catch(()=>console.warn("TSNotes:playback_diagnostics_write_failed"));});
    this.register(() => {
      this.active = false;
      this.maintenance.deactivate();
      this.invalidateTarget();
      this.bridge.stop();
      this.cancelLaunch?.();
      if (this.launchTimer) clearInterval(this.launchTimer);
    });
    this.addSettingTab(new BridgeSettingTab(this));
    this.addCommand({id:"show-playback-results",name:"Show recent playback results",callback:()=>this.showPlaybackResults()});
    this.addCommand({id:"reconnect-videoplay",name:"Reconnect VideoPlay",callback:()=>{void this.reconnectPlayback().catch(()=>new Notice("请打开目标浏览器的 TSNotes 配对页重新连接"));}});
    this.addCommand({ id: "open-video-library", name: "Open video library", callback: () => { void this.openLibrary("videos"); } });
    this.addCommand({ id: "open-playlist-library", name: "Open playlist library", callback: () => { void this.openLibrary("playlists"); } });
    this.addCommand({ id: "preview-library-migration", name: "Preview video library migration", callback: () => { void this.previewMigration(); } });
    this.addCommand({ id: "resume-library-migration", name: "Resume video library migration", callback: () => { void this.recoverMigration("resume"); } });
    this.addCommand({ id: "rollback-library-migration", name: "Roll back video library migration", callback: () => { void this.recoverMigration("rollback"); } });
    this.addCommand({ id: "review-library-views", name: "Review library views", callback: () => { void showViewReview(this.app, this.maintenance).catch(e => new Notice("TSNotes: " + e.message)); } });
    this.addCommand({
      id: "copy-pairing",
      name: "Copy local pairing data",
      callback: () => {
        void this.copyPairing();
      },
    });
    this.addCommand({id:"copy-videoplay-tsnotes-link",name:"Copy current VideoPlay timestamp link",callback:()=>{void this.captureTimeLink("copy").catch(e=>this.captureNotice(e));}});
    this.addCommand({id:"insert-videoplay-tsnotes-link",name:"Insert current VideoPlay timestamp link",editorCallback:(editor,ctx)=>{void this.captureTimeLink("insert",editor,ctx).catch(e=>this.captureNotice(e));}});
    this.registerEditorExtension(EditorView.updateListener.of(update=>{if(update.docChanged||update.selectionSet)this.editorEpoch++;}));
    this.registerEvent(this.app.workspace.on("active-leaf-change",()=>{this.editorEpoch++;}));
    this.registerEvent(this.app.workspace.on("file-open",()=>{this.editorEpoch++;}));
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
        const href = target && linkFromElement(target, (node) => EditorView.findFromDOM(node as HTMLElement));
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
  async openLibrary(kind: "videos" | "playlists"): Promise<void> {
    try {
      const core = (this.app as App & { internalPlugins?: { getPluginById: (id: string) => { enabled?: boolean } | undefined } }).internalPlugins?.getPluginById("bases");
      if (!core?.enabled) { new Notice("库视图需要 Obsidian 1.9+ 并启用核心 Bases 插件；不会自动更改设置。"); return; }
      await ensureLibraryViews(this.app, this.settings);
      const paths = libraryPaths(this.settings), file = this.app.vault.getAbstractFileByPath(kind === "videos" ? paths.videoBase : paths.playlistBase);
      if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) { new Notice("TSNotes: " + (e instanceof Error ? e.message : String(e))); }
  }
  async previewMigration(): Promise<void> {
    try { await this.indexReady; const plan = await this.maintenance.preview(), report = await this.maintenance.exportPreview(plan); new MigrationPreviewModal(this.app, this.maintenance, plan, report).open(); }
    catch (e) { new Notice("TSNotes: " + (e instanceof Error ? e.message : String(e)), 10000); }
  }
  async recoverMigration(mode: "resume" | "rollback"): Promise<void> {
    try { await this.indexReady; new MigrationRecoveryModal(this.app, this.maintenance, await this.maintenance.latest(), mode).open(); }
    catch (e) { new Notice("TSNotes: " + (e instanceof Error ? e.message : String(e)), 10000); }
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
  captureNotice(error: unknown): void {
    const messages:Record<string,string>={browser_not_bound:"请先在插件设置中绑定目标浏览器实例",browser_disconnected:"目标浏览器的 VideoPlay 未连接，请打开 VideoPlay 后重试",browser_update_required:"请更新目标浏览器的 TSNotes 扩展",capture_busy:"正在获取时间链接，请稍候",capture_timeout:"获取时间链接超时，请重试",target_changed:"目标浏览器已改变，本次操作已取消",capture_session_changed:"播放会话已改变，请重试",capture_video_changed:"采样时视频发生切换，请重试",video_not_ready:"视频尚未就绪，请稍后重试",video_ad_playing:"正在播放广告，请等待视频恢复",unsupported_live_time:"当前直播无法生成可靠的回放时间链接",editor_changed:"笔记或光标已改变，本次未插入，请重试",frontmatter_insertion:"请将光标放在正文中，不能插入 Properties",multiple_cursors:"请保留一个光标或选区后重试",editor_unavailable:"请在可编辑的 Markdown 正文中执行插入命令",editor_readonly:"当前笔记只读，未插入链接",editor_composing:"请先完成输入法输入后重试",plugin_unloaded:"插件已卸载，本次操作已取消",invalid_capture_result:"收到的时间链接无效，未执行操作"};
    new Notice("TSNotes: "+(messages[error instanceof Error?error.message:""]||"获取时间链接失败，请检查连接后重试"));
  }
  invalidateTarget():void {
    this.targetEpoch++;this.clickSequence++;this.lastAt=0;this.lastClick="";
    this.bridge?.invalidateTarget();this.cancelLaunch?.();this.cancelLaunch=null;
    if(this.launchTimer)clearInterval(this.launchTimer);this.launchTimer=null;
  }
  async changeBrowser(browserBundle:string):Promise<void> {
    this.invalidateTarget();this.local.browserBundle=browserBundle;await this.saveLocal();
  }
  async bindBrowser(clientId:string):Promise<void> {
    this.invalidateTarget();await this.bridge.bindClient(clientId);
  }
  private checkEditor(editor:Editor,ctx:MarkdownView|MarkdownFileInfo):void {
    if(!ctx.file||ctx.file.extension!=="md"||typeof (ctx as MarkdownView).getMode==="function"&&(ctx as MarkdownView).getMode()!=="source")throw Error("editor_unavailable");
    const cm=(editor as Editor&{cm?:{composing?:boolean;state?:{readOnly?:boolean}}}).cm;
    if(cm?.state?.readOnly)throw Error("editor_readonly");
    if(cm?.composing)throw Error("editor_composing");
  }
  async captureTimeLink(mode:"copy"|"insert",editor?:Editor,ctx?:MarkdownView|MarkdownFileInfo):Promise<{success:true;markdown:string}> {
    if(this.captureBusy)throw Error("capture_busy");
    if(!this.active)throw Error("plugin_unloaded");
    let snapshot:ReturnType<typeof snapshotInsertion>|undefined;
    if(mode==="insert"){
      if(!editor||!ctx)throw Error("editor_unavailable");
      this.checkEditor(editor,ctx);snapshot=snapshotInsertion(editor);
    }
    const epoch=this.targetEpoch,editorEpoch=this.editorEpoch,target=this.bridge.targetKey(),file=ctx?.file,path=file?.path;
    this.captureBusy=true;
    try{
      const result=await this.bridge.capture() as {success?:boolean;reasonCode?:string;reason?:string};
      if(!this.active)throw Error("plugin_unloaded");
      if(epoch!==this.targetEpoch||target!==this.bridge.targetKey())throw Error("target_changed");
      if(!result?.success)throw Error(result?.reasonCode||result?.reason||"capture_failed");
      const markdown=captureMarkdown(result);
      if(mode==="copy")await navigator.clipboard.writeText(markdown);
      else{
        if(editorEpoch!==this.editorEpoch||!editor||!ctx||!snapshot||ctx.file!==file||ctx.file?.path!==path||!path||this.app.vault.getAbstractFileByPath(path)!==file||this.app.workspace.activeEditor?.editor!==editor)throw Error("editor_changed");
        this.checkEditor(editor,ctx);applyInsertion(editor,snapshot,markdown);
      }
      new Notice(`${mode==="copy"?"已复制":"已插入"} ${markdown.slice(1,markdown.indexOf("]"))}`);
      return {success:true,markdown};
    }finally{this.captureBusy=false;}
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
  showPlaybackResults():void {
    const modal=new Modal(this.app);modal.titleEl.setText("TSNotes · 最近播放结果");
    modal.contentEl.createEl("pre",{text:JSON.stringify(this.bridge.playback.history,null,2)});
    new Setting(modal.contentEl).addButton(b=>b.setButtonText("重新连接").onClick(()=>{void this.reconnectPlayback().catch(()=>new Notice("请在目标浏览器 TSNotes 配对页重连"));}));modal.open();
  }
  async reconnectPlayback():Promise<void>{
    if(!/^chrome-extension:\/\/[a-p]{32}$/.test(this.local.origin))throw Error("pairing_origin_missing");
    await run("/usr/bin/open",["-b",this.local.browserBundle,this.local.origin+"/bridge.html?reconnect=1"],{timeout:10000});
  }
  async play(url:string):Promise<void>{
    if(!this.isTsnotes(url))throw Error("unsupported_play_url");
    if(this.lastClick===url&&Date.now()-this.lastAt<500)return;
    this.lastClick=url;this.lastAt=Date.now();const sequence=++this.clickSequence,epoch=this.targetEpoch;
    if(this.bridge.connected&&!this.bridge.supportsPlaybackV2()){
      const result=await this.bridge.play(url) as {success?:boolean;reason?:string};
      if(!result?.success)throw Error(result?.reason||"play_failed");new Notice("已发送播放定位；更新浏览器扩展可启用断连保底");return;
    }
    const operationId=this.bridge.playback.begin(url,this.local.browserBindings?.[this.local.browserBundle]);
    let accepted=this.bridge.connected?await this.bridge.playV2(url,operationId):false;
    if(!this.active||epoch!==this.targetEpoch||sequence!==this.clickSequence)return;
    if(!accepted){
      const marked=addPlaybackOpen(url,{v:2,operationId,vaultId:this.local.vaultId,expectedClientId:this.local.browserBindings?.[this.local.browserBundle]});
      try{await run("/usr/bin/open",["-b",this.local.browserBundle,marked],{timeout:10000});}
      catch{this.bridge.playback.unconfirmed(operationId,"browser_launch_failed");throw Error("browser_launch_failed");}
      accepted=!!await this.bridge.playback.wait(operationId,true);
    }
    if(!this.active||epoch!==this.targetEpoch||sequence!==this.clickSequence)return;
    if(!accepted){this.bridge.playback.unconfirmed(operationId,"acceptance_unconfirmed");new Notice("TSNotes 未收到接管确认，请查看目标浏览器；视频可能已在本地打开",9000);return;}
    const result=await this.bridge.playback.wait(operationId);
    if(!this.active||epoch!==this.targetEpoch||sequence!==this.clickSequence)return;
    if(!result){this.bridge.playback.unconfirmed(operationId,"result_unconfirmed");new Notice("未收到最终执行结果，请查看浏览器；不会重复创建窗口",9000);return;}
    if(result.phase==="failed"){new Notice((result.windowReady?"VideoPlay 已打开，定位未完成：":"VideoPlay 接管未完成：")+(result.reasonCode||"playback_failed")+"；请查看浏览器后重试",9000);return;}
    new Notice(result.reasonCode==="playback_requires_user_gesture"?"视频已定位，当前处于暂停状态，请在 VideoPlay 点击播放":result.instanceMismatch?"已在其他实例本地定位，Obsidian 原绑定未改变":this.bridge.connected?"视频已定位，Obsidian 已连接":"视频已定位，Obsidian 联动暂未恢复",7000);
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
    new Setting(containerEl)
      .setName("启动浏览器")
      .setDesc("必须与安装 TSNotes 的浏览器一致。")
      .addDropdown((d) =>
        d
          .addOptions({
            "com.tabbit-ai.Tabbit": "Tabbit",
            "com.citrolabs.ego.lite": "ego lite",
            "com.microsoft.edgemac": "Microsoft Edge",
            "com.google.Chrome": "Google Chrome",
          })
          .setValue(this.plugin.local.browserBundle)
          .onChange(async (value) => {
            await this.plugin.changeBrowser(value);
            this.display();
          }),
      );
    const selectedId=this.plugin.local.browserBindings?.[this.plugin.local.browserBundle]||"";
    const clients=this.plugin.bridge.clients().filter(c=>c.capabilities.includes("capture-link"));
    let candidate=selectedId;
    new Setting(containerEl).setName("绑定目标浏览器实例").setDesc("先在指定浏览器打开 VideoPlay，核对扩展配对页面的客户端标识，再明确保存绑定。此选择与浏览器的保存目标 Vault 无关。")
      .addDropdown(d=>{d.addOption("","请选择在线实例");for(const client of clients)d.addOption(client.clientId,`${client.clientName} · ${client.clientId.slice(0,8)}`);if(selectedId&&!clients.some(c=>c.clientId===selectedId))d.addOption(selectedId,`已绑定 ${selectedId.slice(0,8)}（离线）`);d.setValue(selectedId).onChange(v=>{candidate=v;});})
      .addButton(b=>b.setButtonText("保存绑定").onClick(async()=>{try{await this.plugin.bindBrowser(candidate);new Notice("目标浏览器已绑定");this.display();}catch(e){this.plugin.captureNotice(e);}}))
      .addButton(b=>b.setButtonText("刷新在线实例").onClick(()=>this.display()));
    new Setting(containerEl).setName("视频笔记打开方式")
      .setDesc("保存或定位视频记录时，在专用窗口或主窗口新标签中打开；同一位置已有该笔记时直接激活。")
      .addDropdown(d => d.addOptions({window:"专用独立窗口（默认）",tab:"主窗口新标签页"})
        .setValue(this.plugin.settings.recordOpenMode).onChange(async value => {
          const next = recordOpenMode(value), previous = this.plugin.settings.recordOpenMode;
          this.plugin.settings.recordOpenMode = next;
          try { await this.plugin.saveData(this.plugin.settings); }
          catch { this.plugin.settings.recordOpenMode = previous; d.setValue(previous); new Notice("打开方式保存失败，请重试"); }
        }));
    for (const [key, label] of [
      ["root", "保存根目录"],
      ["videos", "视频库子目录"],
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
    new Setting(containerEl).setName("视频库视图").setDesc("新视频统一进入视频库下的 _records；Playlist 索引使用共享 Base。已有文件不会自动移动。")
      .addButton(b => b.setButtonText("视频总览").onClick(() => this.plugin.openLibrary("videos")))
      .addButton(b => b.setButtonText("Playlist 总览").onClick(() => this.plugin.openLibrary("playlists")))
      .addButton(b => b.setButtonText("迁移预览").onClick(() => this.plugin.previewMigration()))
      .addButton(b => b.setButtonText("检查视图模板").onClick(() => { void showViewReview(this.app, this.plugin.maintenance); }));
    new Setting(containerEl).setName("播放与连接诊断").addButton(b=>b.setButtonText("最近播放结果").onClick(()=>this.plugin.showPlaybackResults())).addButton(b=>b.setButtonText("重新连接").onClick(()=>{void this.plugin.reconnectPlayback().catch(()=>new Notice("请在浏览器 TSNotes 配对页重连"));}));
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

  }
}
