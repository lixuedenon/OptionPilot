import zh from "./locales/zh";
import en from "./locales/en";

export type Lang = "zh" | "en";

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "en", label: "English", flag: "🇬🇧" },
];

// Shared type so each locale file can import it without a circular
// dependency on the combined `translations` object below.
export type Dict = Record<string, string>;

// To add a new language: create src/i18n/locales/<code>.ts exporting a
// default Dict with the same keys as zh.ts/en.ts, then add one import line
// and one entry each to Lang / LANGS / translations here. No existing
// locale file needs to change.
export const translations: Record<Lang, Dict> = { zh, en };