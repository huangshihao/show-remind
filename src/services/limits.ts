import { CITIES } from "@/lib/cities";

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
