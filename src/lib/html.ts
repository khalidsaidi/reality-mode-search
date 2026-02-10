export type StrongSegment = { text: string; strong: boolean };

const NAMED_ENTITIES: Record<string, string> = {
  quot: "\"",
  apos: "'",
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " "
};

export function decodeHtmlEntities(input: string): string {
  if (!input) return "";

  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (m, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const numStr = hex ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(numStr, hex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return m;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return m;
      }
    }

    const named = NAMED_ENTITIES[entity];
    return typeof named === "string" ? named : m;
  });
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
