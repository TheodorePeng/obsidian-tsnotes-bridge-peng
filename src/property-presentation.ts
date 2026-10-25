import {App, MarkdownView} from "obsidian";
import type {BridgeSettings} from "./model";
import {hideProperty, managedProperties} from "./property-rules";

const css = ".metadata-container .metadata-property[data-tsnotes-hidden='true']{display:none!important}";
interface State { file: string; revealed: boolean; observer: MutationObserver; }
/** Display only: YAML, other notes, and other plugins' settings remain untouched. */
export class PropertyPresentation {
  private states = new Map<MarkdownView, State>();
  private styles = new Map<Document, HTMLStyleElement>();
  private pending = false;
  private active = true;
  constructor(private app: App, private settings: () => BridgeSettings) {}
  schedule(): void {
    if (!this.active || this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; if (this.active) this.refresh(); });
  }
  refresh(): void {
    if (!this.active) return;
    const live = new Set<MarkdownView>();
    this.app.workspace.iterateAllLeaves(leaf => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const view = leaf.view; live.add(view);
      const root = view.containerEl, doc = root.ownerDocument;
      if (!this.styles.has(doc)) { const style = doc.createElement("style"); style.textContent = css; doc.head.append(style); this.styles.set(doc, style); }
      let state = this.states.get(view);
      if (!state) {
        const Observer = doc.defaultView!.MutationObserver;
        const observer = new Observer(records => {
          if (records.some(record => {
            const target = record.target as Element;
            return !!target.closest?.(".metadata-container") || Array.from(record.addedNodes).some(node => node.nodeType === 1 && ((node as Element).matches(".metadata-container") || (node as Element).querySelector(".metadata-container")));
          })) this.schedule();
        });
        observer.observe(root, {childList: true, subtree: true});
        state = {file: "", revealed: false, observer}; this.states.set(view, state);
      }
      const path = view.file?.path || "";
      if (state.file !== path) { state.file = path; state.revealed = false; }
      const props = view.file && this.app.metadataCache.getFileCache(view.file)?.frontmatter || {};
      for (const row of Array.from(root.querySelectorAll<HTMLElement>(".metadata-container .metadata-property"))) {
        const hidden = hideProperty(row.dataset.propertyKey || "", props, this.settings(), state.revealed);
        if (hidden) row.dataset.tsnotesHidden = "true";
        else delete row.dataset.tsnotesHidden;
      }
    });
    for (const [view, state] of this.states) if (!live.has(view)) { state.observer.disconnect(); this.clear(view); this.states.delete(view); }
    for (const [doc, style] of this.styles) if (![...live].some(v => v.containerEl.ownerDocument === doc)) { style.remove(); this.styles.delete(doc); }
  }
  toggleCurrent(): boolean {
    this.refresh();
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const state = view && this.states.get(view);
    if (!view?.file || !state || !managedProperties(this.app.metadataCache.getFileCache(view.file)?.frontmatter || {})) return false;
    state.revealed = !state.revealed; this.refresh(); return true;
  }
  private clear(view: MarkdownView): void { for (const row of Array.from(view.containerEl.querySelectorAll<HTMLElement>("[data-tsnotes-hidden]"))) delete row.dataset.tsnotesHidden; }
  dispose(): void {
    this.active = false;
    for (const [view, state] of this.states) { state.observer.disconnect(); this.clear(view); }
    this.states.clear(); for (const style of this.styles.values()) style.remove(); this.styles.clear();
  }
}
