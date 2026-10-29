// Rules that decide whether a job is worth showing, and how well it matches the resume.

import { CORE, SKILLS, findSkills } from "./skills.ts";
import type { Job } from "./sources.ts";

export type Config = {
  graduation: string;
  maxYears: number;
  locations: { remoteUS: boolean; cities: string[] };
  excludeTitle: string[];
  excludeText: string[];
  includeTitle: string[];
  minScore: number;
};

export type Result = {
  job: Job;
  score: number;
  label: "Strong" | "Good" | "Stretch";
  where: string;
  years: number | null;
  matched: string[];
  missing: string[];
  flags: string[];
  dropped?: string;
};

const NON_US = /\beu\b|europe|uk&i|canada|toronto|vancouver|montreal|london|\buk\b|united kingdom|ireland|dublin|germany|berlin|munich|france|paris|india|bangalore|bengaluru|hyderabad|singapore|japan|tokyo|australia|sydney|brazil|mexico|poland|warsaw|netherlands|amsterdam|spain|madrid|israel|tel aviv|emea|apac|latam|korea|seoul|philippines|argentina|colombia/i;
const US = /\bus\b|\busa\b|u\.s\.|united states|north america|americas|anywhere/i;

export function whereFits(job: Job, cfg: Config): string {
  const loc = job.location.toLowerCase();
  if (cfg.locations.cities.some(c => loc.includes(c))) return "LA/OC";
  if (cfg.locations.remoteUS && job.remote) {
    const parts = job.location.split(/;|\|/).map(p => p.trim()).filter(Boolean);
    const usPart = parts.some(p => !NON_US.test(p) || US.test(p));
    if (!parts.length || usPart) return "Remote US";
  }
  return "";
}

// Smallest "N+ years ... experience" number in the text, or null.
export function minYears(text: string): number | null {
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*years?(?:'|’)?\s*(?:of\s+)?[^.\n]{0,70}?experience/gi;
  let min: number | null = null;
  for (const m of text.matchAll(re)) {
    const n = parseInt(m[1], 10);
    if (n <= 15 && (min === null || n < min)) min = n;
  }
  return min;
}

const ENTRY_TITLE = /new grad|graduate|university|junior|\bjr\.?\b|associate|early.career|entry|apprentice|engineer,? i\b|engineer i\s*[,(-]|\bi\s*$|\blevel 1\b|\bl1\b|\be1\b/i;
const ENTRY_TEXT = /new grad|recent (college )?graduates?|entry.level|early.career|0\s*(?:-|–|to)\s*[12]\s*years|internship experience counts|internships? count/i;
const NOT_ENTRY_TITLE = /\b(ii|iii|iv|2|3|4)\b(?!\d)|\bl[3-9]\b|\be[3-9]\b/i;

export function score(job: Job, resumeSkills: Set<string>, cfg: Config, opts: { keepAll?: boolean; loose?: boolean } = {}): Result {
  const title = job.title.toLowerCase();
  const text = job.text;
  const low = (job.title + "\n" + text).toLowerCase();
  const flags: string[] = [];
  let dropped: string | undefined;

  if (!cfg.includeTitle.some(w => title.includes(w))) dropped = "not an engineering title";
  const badTitle = cfg.excludeTitle.find(w => title.includes(w));
  if (!dropped && badTitle) dropped = `title has "${badTitle.trim()}"`;
  if (!dropped && NOT_ENTRY_TITLE.test(job.title) && !/2026|2027|2025/.test(job.title)) dropped = "title is level II or above";
  const badText = cfg.excludeText.find(w => low.includes(w));
  if (!dropped && badText) dropped = `mentions "${badText.trim()}"`;

  let where = whereFits(job, cfg);
  if (where === "Remote US" && NON_US.test(job.title) && !US.test(job.title)) where = "";
  if (!dropped && !where && !opts.keepAll) dropped = `location not remote US or LA/OC (${job.location || "unknown"})`;

  const years = minYears(text);
  if (!dropped && years !== null && years > cfg.maxYears) dropped = `asks for ${years}+ years`;

  // Skills
  const jd = findSkills(low);
  // A skill you lack that only ever appears next to one you have ("Python, Java, or Go") is an alternative, not a gap.
  const sentences = low.split(/[.\n;]/);
  const have = SKILLS.filter(k => k.core && resumeSkills.has(k.name));
  const isAlt = (name: string) => {
    const k = SKILLS.find(x => x.name === name)!;
    const hits = sentences.filter(x => k.re.test(x));
    return hits.length > 0 && hits.every(x => have.some(h => h.re.test(x))) && !k.re.test(title);
  };
  for (const s of [...jd]) if (!resumeSkills.has(s) && isAlt(s)) jd.delete(s);
  const matched = [...jd].filter(s => resumeSkills.has(s));
  const missing = [...jd].filter(s => !resumeSkills.has(s));
  const w = (s: string) => (CORE.has(s) ? 2 : 1);
  const total = [...jd].reduce((a, s) => a + w(s), 0);
  const got = matched.reduce((a, s) => a + w(s), 0);
  const skillPts = 45 * (got / Math.max(total, 6));

  // Level
  const entryTitle = ENTRY_TITLE.test(job.title);
  const entryText = ENTRY_TEXT.test(text);
  let levelPts = years === null ? (entryTitle || entryText ? 25 : 0) : years <= 1 ? 22 : years <= 2 ? 14 : 0;
  if ((entryTitle || entryText) && years !== null) levelPts = Math.min(25, levelPts + 5);
  if (years === null && !entryTitle && !entryText) {
    flags.push("没写年限，也没写是初级岗");
    if (!dropped && !opts.loose) dropped = "level unclear (use --loose to include)";
  }

  // Graduation window (e.g. "graduating between Dec 2026 and Jun 2027")
  const gradYear = parseInt(cfg.graduation.slice(0, 4), 10);
  const gradYears = [...low.matchAll(/graduat[^.\n]{0,80}/g)].flatMap(m => [...m[0].matchAll(/20(2\d)/g)].map(y => 2000 + parseInt(y[1], 10)));
  if (/20(2[6-9])/.test(job.title) && !gradYears.length) gradYears.push(parseInt(job.title.match(/20(2[6-9])/)![0], 10));
  let gradPenalty = 0;
  if (gradYears.length && Math.min(...gradYears) > gradYear) {
    flags.push(`毕业时间要求像是 ${Math.min(...gradYears)}+，你是 ${cfg.graduation}，先确认资格`);
    gradPenalty = 15;
  }

  const locPts = where ? 15 : 0;

  // AI-native bonus
  const ai = ["Claude Code / Codex / Cursor", "LLMs", "AI agents", "RAG / embeddings"].filter(s => jd.has(s));
  const aiPts = Math.min(10, ai.length * 3 + (jd.has("Claude Code / Codex / Cursor") ? 4 : 0));

  // Languages you don't have, named in the title, are a bigger gap
  const titleGap = ["Go", "Rust", "Kotlin", "Swift/iOS", "Android", "C#/.NET", "Ruby/Rails", "Scala"].filter(s => missing.includes(s));
  const gapPenalty = Math.min(15, titleGap.length * 5);
  if (titleGap.length) flags.push(`要你没写过的语言：${titleGap.join(", ")}`);
  if (/on-?call/i.test(text)) flags.push("有 on-call");
  if (/sponsor/i.test(text) && /(not|unable|cannot|won't|will not)[^.]{0,30}sponsor/i.test(text)) flags.push("不办签证（你是否需要自己判断）");

  const raw = skillPts + levelPts + locPts + aiPts - gradPenalty - gapPenalty;
  const sc = Math.max(0, Math.min(100, Math.round(raw)));
  const label = sc >= 70 ? "Strong" : sc >= 50 ? "Good" : "Stretch";
  return { job, score: sc, label, where, years, matched, missing, flags, dropped };
}
