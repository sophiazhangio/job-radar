// npm run new-profile -- <name> "<plain description>" [--model llama3.2:3b] [--force]
//
// Drafts profiles/<name>/ with a local model through Ollama (free, runs on your computer), then checks it:
// every skill pattern must compile, every suggested job board must answer, and boards from the other
// profiles are kept when they currently post matching titles. The result is marked "draft": true
// for a person to review. This is the only part of job-radar that uses AI, and only when you run it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROFILES, listProfiles } from "./skills.ts";
import { fetchAll, type FetchOpts } from "./sources.ts";
import { titleAllowed, NON_US, US, type Config } from "./score.ts";

const log = (s: string) => process.stderr.write(s + "\n");
const done = (o: object, code = 0) => { console.log(JSON.stringify(o)); process.exit(code); };

const SENIOR = ["senior", "sr", "staff", "principal", "lead", "manager", "director", "head of", "vp", "chief", "intern", "internship", "co-op"];
const EXCLUDE_TEXT = ["security clearance", "ts/sci", "secret clearance", "itar", "department of defense", "dod ", "defense"];

// Turns a careers-page URL into a [board type, token] pair, or null when the board type isn't supported.
export function boardFromUrl(url: string): [string, string] | null {
  const u = url.trim();
  let m = u.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i) || u.match(/boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i);
  if (m) return ["greenhouse", m[1]];
  if ((m = u.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i))) return ["ashby", decodeURIComponent(m[1])];
  if ((m = u.match(/jobs\.lever\.co\/([\w.-]+)/i))) return ["lever", m[1]];
  if ((m = u.match(/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/i))) return ["workday", `${m[1]}.${m[2]}/${m[3]}`];
  if ((m = u.match(/(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/i))) return ["smartrecruiters", m[1]];
  if ((m = u.match(/([\w-]+)\.bamboohr\.com/i))) return ["bamboohr", m[1]];
  if ((m = u.match(/([\w.-]+)\.oraclecloud\.com\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([\w-]+)/i))) return ["oracle", `${m[1]}/${m[2]}`];
  return null;
}

// A keyword list -> one pattern that matches any of them as whole words (works for "c++", "a+", "node.js").
function pattern(words: string[]): string | null {
  const ws = [...new Set(words.map(w => String(w).toLowerCase().trim()).filter(w => w.length > 1 && w.length < 60))];
  if (!ws.length) return null;
  const esc = ws.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  const p = `(?<![a-z0-9])(?:${esc.join("|")})(?![a-z0-9])`;
  try { new RegExp(p); return p; } catch { return null; }
}

async function askModel(model: string, host: string, description: string): Promise<any> {
  const prompt = `You help set up a job-search tool for this career: "${description}".
Reply with JSON only, in exactly this shape:
{
  "description": "one sentence describing the jobs this covers",
  "titles": ["8 to 15 lowercase words or short phrases found in job titles for this career, e.g. 'registered nurse', 'rn'"],
  "excludeTitles": ["lowercase title words for different careers that could be confused with this one"],
  "searchTerms": ["4 to 8 short job-search phrases"],
  "skills": [{"name": "Skill name", "synonyms": ["lowercase ways postings write it"], "core": true}],
  "companies": [{"name": "Employer name", "careersUrl": "https://... their job board if you know it"}]
}
Give 20 to 40 skills: tools, software, certifications, licenses and methods employers ask for. Mark the 5 to 8 most central ones "core": true.
List up to 20 well-known US employers that hire for this career. Only give a careersUrl you are sure of; otherwise leave it "".`;
  const r = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: false, format: "json", options: { temperature: 0.2 }, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) throw new Error(`Ollama answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return JSON.parse((await r.json()).message?.content ?? "{}");
}

// Checks each board (at most 8 at a time); returns the ones that answered, with their matching-title count.
async function checkBoards(list: [string, string, string][], opts: FetchOpts): Promise<{ board: [string, string, string]; postings: number; matches: number }[]> {
  const out: { board: [string, string, string]; postings: number; matches: number }[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < list.length) {
      const b = list[i++];
      let failed = false;
      const jobs = await fetchAll([b], () => { failed = true; }, opts);
      if (!failed) out.push({ board: b, postings: jobs.length, matches: jobs.filter(j => opts.titleOk(j.title)).length });
    }
  }));
  return out;
}

export async function newProfile(argv: string[]) {
  const flags = new Set(argv.filter(a => a.startsWith("--")));
  const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--model", "--host"].includes(argv[i - 1])));
  const [name, description] = pos;
  const model = val("model") ?? "llama3.2:3b";
  const host = val("host") ?? "http://localhost:11434";
  if (!name || !description) done({ ok: false, error: 'Usage: npm run new-profile -- <name> "<plain description of the career>" [--model llama3.2:3b] [--force]' }, 1);
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(name)) done({ ok: false, error: "Name must be 2-31 lowercase letters, digits or dashes, e.g. nursing or data-analyst." }, 1);
  const dir = resolve(PROFILES, name);
  if (existsSync(dir) && !flags.has("--force")) done({ ok: false, error: `profiles/${name} already exists. Pass --force to replace it.` }, 1);

  log(`Asking ${model} for a first draft (can take a minute or two)…`);
  let ai: any;
  try { ai = await askModel(model, host, description); }
  catch (e: any) {
    const msg = /fetch failed|ECONNREFUSED/i.test(String(e?.cause ?? e?.message)) ? `Ollama isn't running at ${host}. Install it from https://ollama.com, then run: ollama pull ${model}` : e.message;
    done({ ok: false, error: msg }, 1);
  }

  const dropped: string[] = [];
  const skills: { name: string; pattern: string; core: boolean }[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(ai.skills) ? ai.skills : []) {
    const n = String(s?.name ?? "").trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    // "Electronic Medical Records (EMR)" -> also "electronic medical records" and "emr"
    const paren = n.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const p = pattern([n, ...(paren ? [paren[1], paren[2]] : []), ...(Array.isArray(s.synonyms) ? s.synonyms : [])]);
    if (!p) { dropped.push(`skill "${n}": no usable pattern`); continue; }
    seen.add(n.toLowerCase());
    skills.push({ name: n, pattern: p, core: !!s.core });
  }
  const strs = (x: unknown) => (Array.isArray(x) ? x : []).map(v => String(v).toLowerCase().trim()).filter(v => v.length > 1);
  const titles = [...new Set(strs(ai.titles))];
  if (!titles.length) done({ ok: false, error: "The model gave no job titles. Try again, or describe the career in more detail." }, 1);
  const searchTerms = [...new Set(strs(ai.searchTerms))].slice(0, 8);
  // Whole-word title rules, so a short title word like "rn" doesn't match inside "intern" or "western".
  const excludes = [...new Set([...SENIOR, ...strs(ai.excludeTitles).filter(t => !titles.includes(t))])];
  const defaults = {
    maxYears: 3, requireLevel: false, maxTitleLevel: 2,
    includeTitle: [] as string[],
    includeTitleRe: [pattern(titles)].filter(Boolean),
    excludeTitle: [] as string[],
    excludeTitleRe: [pattern(excludes)].filter(Boolean),
    excludeText: EXCLUDE_TEXT,
  };
  const cfg = { ...defaults, locations: { remoteUS: true, cities: [] }, minScore: 0 } as unknown as Config;
  const opts: FetchOpts = {
    searchTerms: searchTerms.length ? searchTerms : titles.slice(0, 6),
    titleOk: t => !titleAllowed(t, cfg),
    placeOk: loc => !NON_US.test(loc) || US.test(loc),
  };

  // Boards the model suggested.
  const suggested: [string, string, string][] = [];
  for (const c of Array.isArray(ai.companies) ? ai.companies : []) {
    const b = c?.careersUrl ? boardFromUrl(String(c.careersUrl)) : null;
    if (b) suggested.push([String(c.name || b[1]), b[0], b[1]]);
    else if (c?.name) dropped.push(`company "${c.name}": no supported job board link`);
  }
  // Boards already listed in other (reviewed) profiles.
  const known = new Map<string, [string, string, string]>();
  for (const p of listProfiles().filter(p => !p.draft && p.name !== name)) {
    for (const b of JSON.parse(readFileSync(resolve(PROFILES, p.name, "companies.json"), "utf8")).companies ?? []) known.set(`${b[1]}:${b[2]}`.toLowerCase(), b);
  }
  log(`Checking ${suggested.length} suggested and ${known.size} known job boards for matching titles (about a minute)…`);
  const [okSuggested, okKnown] = await Promise.all([checkBoards(suggested, opts), checkBoards([...known.values()], opts)]);
  for (const b of suggested) if (!okSuggested.some(o => o.board === b)) dropped.push(`company "${b[0]}": job board didn't answer (${b[1]}/${b[2]})`);
  const companies = new Map<string, [string, string, string]>();
  for (const o of okSuggested.filter(o => o.postings > 0)) companies.set(`${o.board[1]}:${o.board[2]}`.toLowerCase(), o.board);
  for (const o of okKnown.filter(o => o.matches > 0).sort((a, b) => b.matches - a.matches)) companies.set(`${o.board[1]}:${o.board[2]}`.toLowerCase(), o.board);
  const matchesFound = [...okSuggested, ...okKnown].reduce((a, o) => a + o.matches, 0);

  const profile = {
    name,
    description: String(ai.description || description).trim(),
    draft: true,
    _note: `Drafted by npm run new-profile with ${model} from: "${description}". Review the skills, titles and companies, then delete "draft".`,
    skills,
    searchTerms: opts.searchTerms,
    defaults,
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "profile.json"), JSON.stringify(profile, null, 2) + "\n");
  const body = [...companies.values()].map(c => "    " + JSON.stringify(c)).join(",\n");
  writeFileSync(resolve(dir, "companies.json"), `{\n  "_note": "Drafted by npm run new-profile; every board here answered when it was made. Add more with npm run add-company -- ${name} <careers page URL>.",\n  "companies": [\n${body}\n  ]\n}\n`);
  log(`Wrote ${dir} (${skills.length} skills, ${companies.size} job boards, ${matchesFound} matching postings right now).`);
  done({ ok: true, profile: name, skills: skills.length, titles: titles.length, companies: companies.size, matchingPostings: matchesFound, dropped, dir });
}

// npm run add-company -- <profile> <careers page URL> ["Display name"]: adds one board after checking it answers.
export async function addCompany(argv: string[]) {
  const [name, url, display] = argv.filter(a => !a.startsWith("--"));
  if (!name || !url) done({ ok: false, error: 'Usage: npm run add-company -- <profile> <careers page URL> ["Display name"]' }, 1);
  const file = resolve(PROFILES, name, "companies.json");
  if (!existsSync(file)) done({ ok: false, error: `No profile named "${name}".` }, 1);
  const b = boardFromUrl(url);
  if (!b) done({ ok: false, error: "That link isn't on a supported job board (Greenhouse, Ashby, Lever, Workday, SmartRecruiters, BambooHR, Oracle). Open one job posting on the company's careers page and use that address." }, 1);
  const board: [string, string, string] = [display ?? b![1], b![0], b![1]];
  let err = "";
  const jobs = await fetchAll([board], e => { err = e; }, { searchTerms: [], titleOk: () => true });
  if (err) done({ ok: false, error: `The board didn't answer: ${err}` }, 1);
  const data = JSON.parse(readFileSync(file, "utf8"));
  data.companies ??= [];
  if (data.companies.some((c: string[]) => c[1] === board[1] && c[2].toLowerCase() === board[2].toLowerCase())) done({ ok: true, added: false, note: "Already listed.", board });
  data.companies.push(board);
  const body = data.companies.map((c: string[]) => "    " + JSON.stringify(c)).join(",\n");
  writeFileSync(file, `{\n  "_note": ${JSON.stringify(data._note ?? "")},\n  "companies": [\n${body}\n  ]\n}\n`);
  done({ ok: true, added: true, board, postings: jobs.length });
}
