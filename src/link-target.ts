import type { Editor, EditorPosition } from "obsidian";
/** Resolve a clicked Markdown link or URL without changing the document. */
export function eventElement(target: EventTarget | null): Element | null {
  // Obsidian adopts main-window nodes into popouts without changing their realm.
  const node = target as Node | null;
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  return element && typeof element.closest === "function" ? element : null;
}

interface SourceLinkView {
  posAtDOM(node: Node): number;
  state: { doc: { lineAt(pos: number): { from: number; text: string } } };
}

/** Live Preview renders link labels as spans. Resolve them in the document's
 * capture listener, before Obsidian consumes the editor mouse event. */
export function linkFromElement(
  target: Element,
  editorFor: (node: Element) => SourceLinkView | null | undefined,
): string | null {
  const anchor = target.closest("a[href],.external-link[data-href]");
  const href = anchor?.getAttribute("href") || anchor?.getAttribute("data-href");
  if (href) return href;
  const label = target.closest(".cm-link,.cm-url,.cm-hmd-external-link");
  if (!label) return null;
  try {
    const view = editorFor(label);
    if (!view) return null;
    const pos = view.posAtDOM(label), line = view.state.doc.lineAt(pos);
    return linkAt(line.text, pos - line.from);
  } catch {
    return null;
  }
}

export function linkAt(line: string, offset: number): string | null {
  for (const match of line.matchAll(
    /\[[^\]]*\]\((?:<(https?:\/\/[^<>]+)>|(https?:\/\/[^\s)]+))(?:\s+"[^"]*")?\)/g,
  ))
    if (offset >= match.index! && offset <= match.index! + match[0].length)
      return match[1] || match[2];
  for (const match of line.matchAll(/https?:\/\/[^\s<>\]\)]+/g))
    if (offset >= match.index! && offset <= match.index! + match[0].length)
      return match[0];
  return null;
}

export function captureMarkdown(input: unknown): string {
  const data = input as {success?:boolean;url?:unknown;seconds?:unknown;sampledAt?:unknown;sessionId?:unknown};
  if(!data?.success||typeof data.url!=="string"||data.url.length>16384||/[\u0000-\u001f<>]/.test(data.url)||!Number.isSafeInteger(data.seconds)||Number(data.seconds)<0||typeof data.sampledAt!=="number"||!Number.isFinite(data.sampledAt)||Date.now()-data.sampledAt>8000||data.sampledAt-Date.now()>1000||typeof data.sessionId!=="string"||!data.sessionId||data.sessionId.length>160)throw Error("invalid_capture_result");
  const u = new URL(data.url),seconds=Number(data.seconds);
  const last=u.search.slice(1).split("&").at(-1);
  if(u.protocol!=="https:"||u.username||u.password||!["youtube.com","www.youtube.com","m.youtube.com","youtu.be","bilibili.com","www.bilibili.com","m.bilibili.com","pan.baidu.com"].includes(u.hostname)||u.searchParams.getAll("t").length!==1||u.searchParams.get("t")!==`${seconds}s`||u.searchParams.getAll("type").length!==1||last!=="type=TSNotes"||u.searchParams.has("__tsnotes_vault")||u.searchParams.has("__tsnotes_ticket"))throw Error("invalid_capture_result");
  const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
  const label=[...(h?[String(h).padStart(2,"0")]:[]),String(m).padStart(2,"0"),String(s).padStart(2,"0")].join(":");
  return `[${label}](${/[()\s]/.test(data.url)?`<${data.url}>`:data.url}) `;
}

type InsertEditor=Pick<Editor,"getValue"|"getCursor"|"listSelections"|"posToOffset"|"transaction">;
export interface InsertSnapshot { text:string; from:EditorPosition; to:EditorPosition; offset:number; selections:string }
export function snapshotInsertion(editor:InsertEditor):InsertSnapshot {
  if(editor.listSelections().length!==1)throw Error("multiple_cursors");
  const text=editor.getValue(),from={...editor.getCursor("from")},to={...editor.getCursor("to")};
  const lines=text.split("\n");
  if(/^\uFEFF?---\r?$/.test(lines[0])){
    const closing=lines.findIndex((line,i)=>i>0&&/^(---|\.\.\.)\r?$/.test(line));
    if(closing<0||from.line<=closing)throw Error("frontmatter_insertion");
  }
  return {text,from,to,offset:editor.posToOffset(to),selections:JSON.stringify(editor.listSelections())};
}
export function applyInsertion(editor:InsertEditor,snapshot:InsertSnapshot,markdown:string):void {
  if(editor.getValue()!==snapshot.text||JSON.stringify(editor.listSelections())!==snapshot.selections||JSON.stringify(editor.getCursor("from"))!==JSON.stringify(snapshot.from)||JSON.stringify(editor.getCursor("to"))!==JSON.stringify(snapshot.to))throw Error("editor_changed");
  const previous=snapshot.text[snapshot.offset-1],text=(previous&&!/\s/.test(previous)?" ":"")+markdown;
  const caret={line:snapshot.to.line,ch:snapshot.to.ch+text.length};
  editor.transaction({changes:[{from:snapshot.to,text}],selection:{from:caret,to:caret}},"tsnotes-link-insert");
}
