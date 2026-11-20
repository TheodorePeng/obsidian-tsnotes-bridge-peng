import type { App, Editor, MarkdownFileInfo, MarkdownView, TFile } from "obsidian";
import { applyInsertion, snapshotInsertion } from "./link-target";

type EditorContext = MarkdownView | MarkdownFileInfo;
type CanvasTextCard = {
  id: string;
  isEditing: boolean;
  nodeEl: HTMLElement;
  getData: () => { type: string };
};
type CanvasEditorContext = EditorContext & { node?: CanvasTextCard };
type CanvasView = {
  getViewType(): string;
  file?: TFile | null;
  containerEl: HTMLElement;
  canvas?: { nodes?: Map<string, CanvasTextCard> };
};

function nativeEditor(editor: Editor) {
  return (editor as Editor & {
    cm?: { dom?: HTMLElement; composing?: boolean; state?: { readOnly?: boolean } };
  }).cm;
}

function checkWritable(editor: Editor): void {
  if (nativeEditor(editor)?.state?.readOnly) throw Error("editor_readonly");
}

// A command can run before CodeMirror receives the IME's composition end.
// Give that event a short window without disturbing the native input session.
async function waitForCompositionEnd(editor: Editor): Promise<void> {
  const deadline = performance.now() + 300;
  while (nativeEditor(editor)?.composing === true) {
    if (performance.now() >= deadline) throw Error("editor_composing");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export function settleEditorComposition(editor: Editor): Promise<void> | undefined {
  if (nativeEditor(editor)?.composing === true) return waitForCompositionEnd(editor);
}

function belongsToCard(editor: Editor, card: HTMLElement): boolean {
  const dom = nativeEditor(editor)?.dom;
  if (!dom?.isConnected || !card.isConnected) return false;
  const frame = dom.ownerDocument.defaultView?.frameElement;
  return card.contains(dom) || Boolean(frame && card.contains(frame));
}

function canvasTarget(app: App, editor: Editor, info: CanvasEditorContext): (() => boolean) | undefined {
  const leaf = app.workspace.activeLeaf;
  const view = leaf?.view as CanvasView | undefined;
  const file = view?.file;
  const card = info.node;
  const nodes = view?.canvas?.nodes;
  if (view?.getViewType() !== "canvas" || file?.extension !== "canvas" ||
      !card?.nodeEl || !nodes || typeof card.getData !== "function" || card.getData().type !== "text") return;
  const element = card.nodeEl;
  const path = file.path;
  return () => {
    const active = app.workspace.activeEditor as CanvasEditorContext | null;
    return app.workspace.activeLeaf === leaf && leaf?.view === view &&
      view.file === file && file.path === path && app.vault.getAbstractFileByPath(path) === file &&
      view.canvas?.nodes === nodes && nodes.get(card.id) === card && card.nodeEl === element &&
      card.isEditing && view.containerEl.contains(element) && active?.node === card &&
      active.editor === editor && belongsToCard(editor, element);
  };
}

export function prepareTimestampInsertion(app: App, editor: Editor, ctx: EditorContext): (markdown: string) => void {
  const file = ctx.file;
  const markdownFile = file?.extension === "md";
  let isCurrent: (() => boolean) | undefined;
  if (markdownFile) {
    const path = file.path;
    const view = ctx as MarkdownView;
    isCurrent = () => ctx.file === file && file.path === path &&
      (typeof view.getMode !== "function" || view.getMode() === "source") &&
      app.vault.getAbstractFileByPath(path) === file && app.workspace.activeEditor?.editor === editor;
  } else {
    isCurrent = canvasTarget(app, editor, ctx);
  }
  if (!isCurrent?.()) throw Error("editor_unavailable");
  checkWritable(editor);
  const snapshot = snapshotInsertion(editor, markdownFile);
  const validate = isCurrent;
  return (markdown) => {
    if (!validate()) throw Error("editor_changed");
    checkWritable(editor);
    if (nativeEditor(editor)?.composing === true) throw Error("editor_composing");
    applyInsertion(editor, snapshot, markdown);
  };
}
