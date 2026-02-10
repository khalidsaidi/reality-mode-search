import { franc } from "franc-min";

export function detectLang(text: string, opts?: { minLength?: number }): string {
  const t = text.trim();
  if (!t) return "unknown";

  // franc-min expects enough text to detect reliably; "und" = undetermined.
  const minLength = opts?.minLength ?? 10;
  const code = franc(t, { minLength });
  if (!code || code === "und") return "unknown";
  return code;
}
