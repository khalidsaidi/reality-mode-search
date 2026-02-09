export const MAX_QUERY_LENGTH = 256;

export function normalizeQuery(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const collapsed = trimmed.replace(/\s+/g, " ");
  const lowered = collapsed.toLowerCase();
  return lowered.slice(0, MAX_QUERY_LENGTH);
}

