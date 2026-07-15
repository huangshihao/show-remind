import { CITIES } from "@/lib/cities";

// Mirrors what /api/config offers. Every city is crawlable, so accepting any of
// these is safe; a code outside the list has no Showstart mapping and would be a
// subscription that never matches.
export const CITY_CODES = new Set(CITIES.map((c) => c.code));
export const MAX_ARTISTS = 100;
export const MAX_CITIES = 10;

export function validCities(cities: string[]): boolean {
  if (!Array.isArray(cities) || cities.length === 0 || cities.length > MAX_CITIES) return false;
  return cities.every((c) => CITY_CODES.has(c));
}

export function isEmail(s: string): boolean {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
