// Rules that decide whether a job is worth showing, and how well it matches the resume.
//
// Two scores, each out of 100:
//   resume — how well your resume covers the job's skills (required ones count most)
//   fit    — whether the job fits what you are looking for (level, location, AI focus, graduation window)
// total = 60% resume + 40% fit, used for sorting.

import { CORE, SKILLS, findSkills } from "./skills.ts";
import type { Job } from "./sources.ts";
import { L } from "./i18n.ts";
import { existsSync, readFileSync } from "node:fs";

// Common English words (lowercase entries of the system dictionary), used to keep keyword gaps technical.
let DICT: Set<string> | null = null;
function common(w: string): boolean {
  if (!DICT) {
    const f = "/usr/share/dict/words";
    DICT = new Set(existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(x => x && x === x.toLowerCase()) : []);
  }
  const base = w.replace(/(ies|es|s|ed|ing)$/, "");
  return DICT.has(w) || DICT.has(base) || DICT.has(base + "e") || DICT.has(w.replace(/s$/, ""));
}

export type Config = {
  graduation: string;
  maxYears: number;
  locations: { remoteUS: boolean; cities: string[]; label?: string };
  excludeTitle: string[];
  excludeText: string[];
  includeTitle: string[];
  minScore: number;
};

export type Resume = { text: string; skills: Set<string> };

export type Result = {
  job: Job;
  score: number;
  resumeScore: number;
  fitScore: number;
  label: "Strong" | "Good" | "Stretch";
  where: string;
  years: number | null;
  required: string[]; // skills found in the requirements part of the posting
  nice: string[]; // skills found in nice-to-have or elsewhere
  matched: string[];
  missingRequired: string[];
  missingNice: string[];
  keywords: string[]; // frequent posting terms that never appear in the resume
  flags: string[];
  dropped?: string;
  tracked?: { status: string; applied: string }; // from the online tracker export
};

const NON_US = /\beu\b|europe|uk&i|canada|toronto|vancouver|montreal|london|\buk\b|united kingdom|ireland|dublin|germany|berlin|munich|france|paris|india|bangalore|bengaluru|hyderabad|singapore|japan|tokyo|australia|sydney|brazil|mexico|poland|warsaw|netherlands|amsterdam|spain|madrid|israel|tel aviv|emea|apac|latam|korea|seoul|philippines|argentina|colombia/i;
const US = /\bus\b|\busa\b|u\.s\.|united states|north america|americas|anywhere/i;

export function whereFits(job: Job, cfg: Config): string {
  const loc = job.location.toLowerCase();
  if (cfg.locations.cities.some(c => loc.includes(c))) return cfg.locations.label || "Local";
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

// ---- Splitting a posting into required / nice-to-have / other parts ----

type Part = "required" | "nice" | "other";
const H_NICE = /nice.to.have|bonus|preferred|pluses|extra credit|great if|would be (great|nice|a plus)|not required|stand out|it'?s a plus|even better/i;
const H_REQ = /requirement|qualification|what you('ll)? (need|bring)|you (have|bring|might be)|must.have|about you|looking for|who you are|minimum|what we('re)? look|you should have|skills/i;
const H_OTHER = /benefit|perks|about (us|the)|what you('ll)? (do|work)|responsibilit|the role|role overview|compensation|salary|pay range|equal opportunity|why (join|work)|culture|how we|interview|day.to.day|in this role|our team|the team|location|who we are|mission/i;
const LINE_NICE = /\b(a plus|is a plus|are a plus|bonus|nice to have|preferred|ideally|helpful)\b/i;

export function splitParts(text: string): { lines: { text: string; part: Part }[]; found: boolean } {
  let part: Part = "other";
  let found = false;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean).map(line => {
    const short = line.length <= 80 && line.split(/\s+/).length <= 10 && !/[.!?]$/.test(line);
    if (short || line.endsWith(":")) {
      if (H_NICE.test(line)) { part = "nice"; found = true; return { text: line, part }; }
      if (H_REQ.test(line)) { part = "required"; found = true; return { text: line, part }; }
      if (H_OTHER.test(line)) { part = "other"; return { text: line, part }; }
    }
    return { text: line, part: part === "required" && LINE_NICE.test(line) ? "nice" as Part : part };
  });
  return { lines, found };
}

// ---- Posting terms the resume never mentions ----

const STOP = new Set(`a about above across after again all also an and any are as at be because been before being between both but by can could did do does doing during each either etc every few for from further had has have having help how i if in including into is it its itself just like make may more most must my new no not now of on once one only or other our out over own per plus same should so some such than that the their them then there these they this those through to too under until up us use used using very via want was we well were what when where which while who whom why will with within without would you your yours yourself
able ability across work working team teams experience experiences role build building strong great good best skills skill year years knowledge understanding including environment environments company product products customer customers job candidate candidates opportunity opportunities based level range salary pay equity benefits time across people world help helping new day days part full plus within role's high quality ensure across deliver delivering support supporting own owning end ideal looking join based apply application applicants equal employer status law laws basis gender race religion disability veteran national origin sexual orientation identity age please information applicable including location locations office offices hybrid remote compensation bonus total package range ranges factors factor including market across us usa united states california new york francisco san city need needs bring brings behind interest interested useful intuitive specialized full-time part-time headquarters following disciplines discipline graduation date familiarity familiar competencies competency creative passion passionate excited exciting fast fast-paced pace paced self-starter detail detail-oriented oriented curious curiosity collaborative collaborate collaboration communication communicate clear clearly written verbal problem problems solving solve solver mindset growth learn learning eager motivated thrive thrives ambiguity ownership impact impactful meaningful hands-on hands proven track record demonstrated solid deep excellent exceptional comfortable responsible responsibilities required requirements preferred qualifications minimum degree bachelor bachelor's computer science field related equivalent practical professional industry real-world modern scalable reliable maintainable robust high-quality highly various multiple different similar relevant other others ideally especially particularly someone person individual engineers engineer engineering software developer developers development code coding codebase technical technology technologies tools tool feature features projects project internship internships intern college university students student grads grad graduate graduates recent santa monica angeles los`.split(/\s+/));

export function keywordGaps(text: string, resumeText: string, company = "", limit = 8): string[] {
  const resume = resumeText.toLowerCase();
  const companyWords = new Set(company.toLowerCase().split(/\W+/).filter(Boolean));
  // words written with a capital letter mid-sentence (Figma, Hono, HIPAA) or with tech symbols (ci/cd, k8s)
  const proper = new Set<string>();
  for (const m of text.matchAll(/(?<=[a-z0-9,] )([A-Z][A-Za-z0-9+#.]*[A-Za-z0-9+#]|[A-Z]{2,})\b/g)) proper.add(m[1].toLowerCase());
  const techy = (w: string) => w.length > 2 && !common(w) && (proper.has(w) || (/[0-9+#/]/.test(w) && /[a-z]/.test(w) && w !== "and/or"));
  const counts = new Map<string, number>();
  const add = (t: string) => counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const sentence of text.toLowerCase().split(/[.\n;:!?()•·]/)) {
    const words = sentence.split(/[^a-z0-9+#.\-/]+/).map(w => w.replace(/^[.\-/]+|[.\-/]+$/g, "")).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length > 1 && !STOP.has(w) && !companyWords.has(w) && techy(w)) add(w);
      const n = words[i + 1];
      if (n && !STOP.has(w) && !STOP.has(n) && !companyWords.has(w) && !companyWords.has(n) && w.length > 2 && n.length > 2 && !/^\d/.test(w) && !/^\d/.test(n)) add(`${w} ${n}`);
    }
  }
  const knownSkill = (t: string) => SKILLS.some(k => k.re.test(t));
  const out = [...counts.entries()]
    .filter(([t, c]) => (c >= 2 || (!t.includes(" ") && proper.has(t))) && !resume.includes(t) && !knownSkill(t))
    .map(([t, c]) => [t, c * (t.includes(" ") ? 2 : 1)] as const) // two-word phrases say more
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);
  // drop single words already inside a chosen phrase
  const picked: string[] = [];
  for (const t of out) {
    if (picked.length >= limit) break;
    if (picked.some(p => p.includes(t) || t.includes(p))) continue;
    picked.push(t);
  }
  return picked;
}

// ---- Scoring ----

export function score(job: Job, resume: Resume, cfg: Config, opts: { keepAll?: boolean; loose?: boolean } = {}): Result {
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
  if (!dropped && !where && !opts.keepAll) dropped = `location not remote US or one of your cities (${job.location || "unknown"})`;

  const years = minYears(text);
  if (!dropped && years !== null && years > cfg.maxYears) dropped = `asks for ${years}+ years`;

  // ---- Resume score ----
  const has = resume.skills;
  const jd = findSkills(low);
  // A skill you lack that only ever appears next to one you have ("Python, Java, or Go") is an alternative, not a gap.
  const sentences = low.replace(/\be\.g\.|\bi\.e\.|\betc\./g, m => m.replace(/\./g, "")).split(/[\n;]|\.(?=\s|$)/);
  const haveCore = SKILLS.filter(k => k.core && has.has(k.name));
  const LANGS = new Set(["Go", "Rust", "Kotlin", "Swift/iOS", "C#/.NET", "C/C++", "Ruby/Rails", "PHP", "Scala", "Java", "Python", "TypeScript", "JavaScript"]);
  for (const name of [...jd]) {
    if (has.has(name) || !LANGS.has(name)) continue;
    const k = SKILLS.find(x => x.name === name)!;
    const hits = sentences.filter(x => k.re.test(x));
    const alt = (x: string) => haveCore.some(h => h.re.test(x)) && /\bor\b|\bany\b|one of|such as|\beg\b|similar|equivalent|at least one|like /.test(x);
    if (hits.length && hits.every(alt) && !k.re.test(title)) jd.delete(name);
  }

  const { lines, found } = splitParts(text);
  const partOf = (name: string): Part => {
    if (!found) return "required";
    const k = SKILLS.find(x => x.name === name)!;
    const parts = lines.filter(l => k.re.test(l.text.toLowerCase())).map(l => l.part);
    // nice only when every mention is in a nice-to-have part; stack named under "what you'll do" counts as required
    return parts.length && parts.every(p => p === "nice") && !k.re.test(title) ? "nice" : "required";
  };
  const required = [...jd].filter(s => partOf(s) === "required");
  const nice = [...jd].filter(s => partOf(s) !== "required");
  const w = (s: string) => (CORE.has(s) ? 2 : 1);
  const sum = (xs: string[]) => xs.reduce((a, s) => a + w(s), 0);
  const reqGot = sum(required.filter(s => has.has(s)));
  const niceGot = sum(nice.filter(s => has.has(s)));
  let reqCov = required.length ? reqGot / sum(required) : 0.6;
  if (!required.length) flags.push(L("要求部分没认出技能，简历分只是估计", "No skills recognized in the requirements; the resume score is a guess"));
  else if (required.length <= 2) flags.push(L(`职位只写了 ${required.length} 个能认出的技能，简历分参考价值低`, `Only ${required.length} recognizable skill(s) in the posting; the resume score says little`));
  const niceCov = nice.length ? niceGot / sum(nice) : 1;
  reqCov = Math.min(1, reqCov);

  const missingRequired = required.filter(s => !has.has(s));
  const missingNice = nice.filter(s => !has.has(s));
  const langGap = ["Go", "Rust", "Kotlin", "Swift/iOS", "Android", "C#/.NET", "Ruby/Rails", "Scala", "C/C++"].filter(s => missingRequired.includes(s));
  if (langGap.length) flags.push(L(`要求里有你没写过的语言：${langGap.join(", ")}`, `Requires languages not on your resume: ${langGap.join(", ")}`));
  const resumeScore = clamp(75 * reqCov + 25 * niceCov - Math.min(30, langGap.length * 10));

  // ---- Fit score ----
  const entryTitle = ENTRY_TITLE.test(job.title);
  const entryText = ENTRY_TEXT.test(text);
  let level = years === null ? (entryTitle || entryText ? 50 : 0) : years <= 1 ? 45 : years <= 2 ? 30 : 0;
  if ((entryTitle || entryText) && years !== null) level = Math.min(50, level + 10);
  if (years === null && !entryTitle && !entryText) {
    flags.push(L("没写年限，也没写是初级岗", "No years or entry-level wording"));
    if (!dropped && !opts.loose) dropped = "level unclear (use --loose to include)";
  }

  const gradYear = parseInt(cfg.graduation.slice(0, 4), 10);
  const gradYears = [...low.matchAll(/graduat[^.\n]{0,80}/g)].flatMap(m => [...m[0].matchAll(/20(2\d)/g)].map(y => 2000 + parseInt(y[1], 10)));
  if (/20(2[6-9])/.test(job.title) && !gradYears.length) gradYears.push(parseInt(job.title.match(/20(2[6-9])/)![0], 10));
  let gradPenalty = 0;
  if (gradYears.length && Math.min(...gradYears) > gradYear) {
    flags.push(L(`毕业时间要求像是 ${Math.min(...gradYears)}+，你是 ${cfg.graduation}，先确认资格`, `Graduation window looks like ${Math.min(...gradYears)}+ (you: ${cfg.graduation}); check eligibility`));
    gradPenalty = 40;
  }

  const loc = where ? 30 : 0;
  const ai = jd.has("Claude Code / Codex / Cursor") ? 20 : Math.min(20, ["LLMs", "AI agents", "RAG / embeddings"].filter(s => jd.has(s)).length * 10);
  const fitScore = clamp(level + loc + ai - gradPenalty);

  if (/on-?call/i.test(text)) flags.push(L("有 on-call", "Includes on-call"));
  if (/(not|unable|cannot|won't|will not)[^.]{0,30}sponsor/i.test(text)) flags.push(L("不办签证（你是否需要自己判断）", "No visa sponsorship"));

  const total = clamp(0.6 * resumeScore + 0.4 * fitScore);
  const label = total >= 70 ? "Strong" : total >= 50 ? "Good" : "Stretch";
  return {
    job, score: total, resumeScore, fitScore, label, where, years,
    required, nice, matched: [...jd].filter(s => has.has(s)), missingRequired, missingNice,
    keywords: dropped && !opts.keepAll ? [] : keywordGaps(found ? lines.filter(l => l.part !== "other").map(l => l.text).join("\n") || text : text, resume.text, job.company),
    flags, dropped,
  };
}

function clamp(n: number): number { return Math.max(0, Math.min(100, Math.round(n))); }
