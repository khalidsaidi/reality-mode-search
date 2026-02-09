import { ISO_COUNTRY_CODES } from "@/lib/isoCountries";

export function inferCountryFromTld(tld: string): string {
  const base = tld.toLowerCase().split(".").pop() ?? tld.toLowerCase();
  if (!base) return "unknown";

  if (base === "uk") return "GB";
  if (base === "tp") return "TL";

  if (!/^[a-z]{2}$/.test(base)) return "unknown";
  const upper = base.toUpperCase();
  return (ISO_COUNTRY_CODES as readonly string[]).includes(upper) ? upper : "unknown";
}

