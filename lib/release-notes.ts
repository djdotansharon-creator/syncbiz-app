/**
 * The notes of a published release, turned into short plain lines for the site's "What's new" page (and nothing else): the bullet lines become the list, the other lines
 * paragraphs; the technical "Installer facts" block (file size, hash, build id) is cut off. Everything is returned as PLAIN TEXT — the page renders text nodes, never HTML.
 */
export type ParsedNotes = { items: string[]; paragraphs: string[] };

function plain(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .trim();
}

export function parseReleaseNotes(body: string | null | undefined): ParsedNotes {
  const out: ParsedNotes = { items: [], paragraphs: [] };
  if (!body) return out;
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^installer facts/i.test(line)) break; // the technical block starts here
    const bullet = /^([-*•])\s+(.*)$/.exec(line);
    const text = plain(bullet ? bullet[2]! : line);
    if (!text) continue;
    if (text.length > 400) continue;
    if (bullet) out.items.push(text);
    else out.paragraphs.push(text);
    if (out.items.length + out.paragraphs.length >= 40) break;
  }
  return out;
}
