// Career profiles and their skill dictionaries.
//
// A profile lives in profiles/<name>/: profile.json (skills, title rules, scoring tweaks)
// and companies.json (which job boards to fetch). Pick one with "profile" in config.local.json.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { L } from "./i18n.ts";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PROFILES = resolve(ROOT, "profiles");

export type Skill = { name: string; re: RegExp; core: boolean };

export type Profile = {
  name: string;
  description: string;
  // pattern: a regular expression tested against lowercase text. "core" skills count double.
  skills: { name: string; pattern: string; core?: boolean }[];
  // Skills where having any one of a "X, Y or Z" list counts (e.g. programming languages).
  alternatives?: string[];
  // Required skills that cost 10 points each when missing from the resume.
  gapPenalty?: string[];
  // Up to 20 fit points: 20 for any "full" skill in the posting, else 10 per "partial" one.
  bonus?: { label: { en: string; zh?: string }; full?: string[]; partial?: string[] };
  // Extra title words that mark an entry or early-career role, as a regular expression.
  entryTitle?: string;
  // Search words for boards that are searched instead of listed in full (Workday, SmartRecruiters, Oracle).
  searchTerms?: string[];
  // Default search rules; any key here can be overridden in config.local.json.
  defaults?: Record<string, unknown>;
};

export let PROFILE: Profile;
export let SKILLS: Skill[] = [];
export let CORE = new Set<string>();

export function listProfiles(): { name: string; description: string }[] {
  if (!existsSync(PROFILES)) return [];
  return readdirSync(PROFILES)
    .filter(n => existsSync(resolve(PROFILES, n, "profile.json")))
    .map(n => ({ name: n, description: JSON.parse(readFileSync(resolve(PROFILES, n, "profile.json"), "utf8")).description ?? "" }));
}

export function useProfile(name = "software"): Profile {
  const file = resolve(PROFILES, name, "profile.json");
  if (!existsSync(file)) {
    const names = listProfiles().map(p => p.name).join(", ");
    throw new Error(L(`没有叫 "${name}" 的 profile。可选：${names}`, `No profile named "${name}". Available: ${names}`));
  }
  PROFILE = JSON.parse(readFileSync(file, "utf8"));
  SKILLS = PROFILE.skills.map(k => ({ name: k.name, re: new RegExp(k.pattern), core: !!k.core }));
  CORE = new Set(SKILLS.filter(k => k.core).map(k => k.name));
  return PROFILE;
}

export const bonusLabel = () => PROFILE.bonus ? L(PROFILE.bonus.label.zh ?? PROFILE.bonus.label.en, PROFILE.bonus.label.en) : "";

export function findSkills(text: string): Set<string> {
  const t = text.toLowerCase();
  return new Set(SKILLS.filter(k => k.re.test(t)).map(k => k.name));
}

useProfile("software");
