const TWO_LEVEL_SUFFIXES = [
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "com.br",
  "co.nz",
  "co.za",
  "com.mx",
  "com.ar",
  "com.tr",
  "com.sa",
  "com.eg"
] as const;

export function getDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function getTld(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  if (!host) return "unknown";

  for (const suffix of TWO_LEVEL_SUFFIXES) {
    if (host === suffix) return suffix;
    if (host.endsWith(`.${suffix}`)) return suffix;
  }

  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return "unknown";
  return parts[parts.length - 1];
}

