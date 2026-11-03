// Experience levels. "level" in config.local.json picks one; the profile's rules are adjusted to match,
// and anything you set yourself in config.local.json still wins.
//   entry   new grad and early career (the profile's own defaults)
//   mid     about 2–5 years: level II/III titles, postings asking 2–5 years
//   senior  5+ years: senior, staff, lead and principal titles

export type Level = "entry" | "mid" | "senior";
export const LEVELS: Level[] = ["entry", "mid", "senior"];

type Preset = {
  label: string;
  minYears?: number; maxYears?: number; maxTitleLevel?: number; requireLevel?: boolean;
  allow: string[]; // title words the profile excludes that this level wants back
  exclude: string[]; // title words to drop at this level
};

const SENIOR_WORDS = ["senior", "sr.", "sr ", "staff", "principal", "lead", "architect"];
const MID_WORDS = ["mid level", "mid-level"];
const ENTRY_WORDS = ["new grad", "new graduate", "junior", "jr.", "jr ", "entry level", "entry-level", "graduate", "early career", "apprentice"];

export const PRESETS: Record<Level, Preset> = {
  entry: { label: "Entry level / new grad", allow: [], exclude: [] },
  mid: { label: "Mid level (about 2–5 years)", minYears: 2, maxYears: 5, maxTitleLevel: 3, requireLevel: false, allow: MID_WORDS, exclude: ["new grad", "new graduate"] },
  senior: { label: "Senior (5+ years)", minYears: 5, maxYears: 12, maxTitleLevel: 9, requireLevel: false, allow: [...SENIOR_WORDS, ...MID_WORDS], exclude: ENTRY_WORDS },
};

// The rules a level adds on top of the profile's defaults.
export function levelRules(defaults: Record<string, any>, level: Level | undefined): Record<string, unknown> {
  const p = PRESETS[level ?? "entry"];
  if (!p || level === "entry" || !level) return {};
  const allow = new Set(p.allow);
  const exclude = [...((defaults.excludeTitle ?? []) as string[]).filter(w => !allow.has(w)), ...p.exclude.filter(w => !(defaults.excludeTitle ?? []).includes(w))];
  const out: Record<string, unknown> = { excludeTitle: exclude };
  for (const k of ["minYears", "maxYears", "maxTitleLevel", "requireLevel"] as const) if (p[k] !== undefined) out[k] = p[k];
  return out;
}
