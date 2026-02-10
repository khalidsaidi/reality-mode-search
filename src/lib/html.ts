import he from "he";

export type StrongSegment = { text: string; strong: boolean };

export function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  // `he` is a mature HTML entity decoder; keep it narrow: decode entities only,
  // then handle tags separately with a strict allowlist.
  return he.decode(input).replace(/\u00a0/g, " ");
}

// Convert small HTML snippets into React-safe segments:
// - Decode entities (so things like &#x27; and &quot; display correctly)
// - Remove all tags except <strong> (Brave uses this for highlighting)
export function parseStrongSegments(input: string): StrongSegment[] {
  const decoded = decodeHtmlEntities(input);
  if (!decoded) return [];

  const normalized = decoded
    .replace(/<\s*strong\b[^>]*>/gi, "<strong>")
    .replace(/<\/\s*strong\s*>/gi, "</strong>")
    .replace(/<\/?(?!strong\b)[a-z][^>]*>/gi, "");

  const tokens = normalized.split(/(<\/?strong>)/g).filter((t) => t !== "");

  const segs: StrongSegment[] = [];
  let strong = false;
  for (const t of tokens) {
    if (t === "<strong>") {
      strong = true;
      continue;
    }
    if (t === "</strong>") {
      strong = false;
      continue;
    }
    segs.push({ text: t, strong });
  }
  return segs;
}

export function toPlainTextFromHtml(input: string): string {
  const decoded = decodeHtmlEntities(input);
  if (!decoded) return "";
  // Strip tags and normalize whitespace so we don't run words together.
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
