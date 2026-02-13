import type { CountryResolutionMode } from "@/lib/countryResolution";
import { ISO_COUNTRY_CODES, type CountryCode } from "@/lib/isoCountries";

export type CountryTarget = {
  requested_country: CountryCode;
  resolved_country: CountryCode;
  country_resolution: Exclude<CountryResolutionMode, "global">;
  tld: string;
};

const COUNTRY_PROXY: Partial<Record<CountryCode, CountryCode>> = {
  // ISO entries without corresponding IANA root-zone ccTLDs.
  BQ: "NL",
  BL: "FR",
  MF: "FR",
  UM: "US",
  EH: "ES",
};

// ccTLDs which are not the ISO alpha-2 code.
const COUNTRY_TLD_OVERRIDE: Partial<Record<CountryCode, string>> = {
  GB: "uk",
};

export function parseCountryCode(rawCountry: string | null): CountryCode | null {
  const countryUpper = rawCountry ? rawCountry.toUpperCase() : "";
  if (!countryUpper) return null;
  if (!(ISO_COUNTRY_CODES as readonly string[]).includes(countryUpper)) return null;
  return countryUpper as CountryCode;
}

export function resolveCountryTarget(country: CountryCode): CountryTarget {
  const proxy = COUNTRY_PROXY[country];
  if (proxy) {
    const override = COUNTRY_TLD_OVERRIDE[proxy];
    const tld = override ?? proxy.toLowerCase();
    return {
      requested_country: country,
      resolved_country: proxy,
      country_resolution: "proxy",
      tld,
    };
  }

  const override = COUNTRY_TLD_OVERRIDE[country];
  const tld = override ?? country.toLowerCase();
  return {
    requested_country: country,
    resolved_country: country,
    country_resolution: "exact",
    tld,
  };
}

