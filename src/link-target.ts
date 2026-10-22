/** Resolve a clicked Markdown link or URL without changing the document. */
export function eventElement(target: EventTarget | null): Element | null {
  // Obsidian adopts main-window nodes into popouts without changing their realm.
  const node = target as Node | null;
  const element = node?.nodeType === 1 ? node as Element : node?.parentElement;
  return element && typeof element.closest === "function" ? element : null;
}

export function linkAt(line: string, offset: number): string | null {
  for (const match of line.matchAll(
    /\[[^\]]*\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]*")?\)/g,
  ))
    if (offset >= match.index! && offset <= match.index! + match[0].length)
      return match[1];
  for (const match of line.matchAll(/https?:\/\/[^\s<>\]\)]+/g))
    if (offset >= match.index! && offset <= match.index! + match[0].length)
      return match[0];
  return null;
}
