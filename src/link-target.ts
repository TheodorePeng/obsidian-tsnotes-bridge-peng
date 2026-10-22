/** Resolve a clicked Markdown link or URL without changing the document. */
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
