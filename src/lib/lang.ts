import { franc } from "franc-min";

export function detectLang(text: string): string {
  const t = text.trim();
  if (!t) return "unknown";

  // franc-min expects enough text to detect reliably; "und" = undetermined.
  const code = franc(t, { minLength: 10 });
  if (!code || code === "und") return "unknown";
  return code;
}

