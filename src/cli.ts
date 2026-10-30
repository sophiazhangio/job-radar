#!/usr/bin/env node
// job-radar: pull entry-level postings from public job boards and score them against your resume.
//
//   node src/cli.ts scan [--top 30] [--all] [--anywhere] [--company Quora] [--dump]
//   node src/cli.ts match <job URL or .txt file>
//   node src/cli.ts tailor <job URL or .txt file> [--bank bank.json] [--no-pdf]
//   node src/cli.ts skills

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readResume } from "./resume.ts";
import { findSkills, useProfile, listProfiles, bonusLabel, PROFILES } from "./skills.ts";
import { fetchAll, fetchOne, type Job } from "./sources.ts";
import { score, titleAllowed, NON_US, US, type Config, type Result, type Resume } from "./score.ts";
import { toHtml } from "./html.ts";
import { loadTracked, makeLookup, statusLabel, FINISHED } from "./tracked.ts";
import { L, setLang } from "./i18n.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

// Personal settings live in config.local.json (gitignored); config.example.json is the template.
// dump, profiles and new-profile also work before setup, using the example config.
const NO_SETUP = ["dump", "profiles", "new-profile", "add-company", "help"].includes(cmd);
const cfgPath = ["config.local.json", "config.json", ...(NO_SETUP ? ["config.example.json"] : [])].map(f => resolve(ROOT, f)).find(f => existsSync(f));
if (!cfgPath) {
  console.error("No config.local.json yet. Run the setup, which asks a few questions:\n  npm run setup\n(or copy config.example.json to config.local.json and edit it)");
  process.exit(1);
}
type Settings = Config & { resume: string; companies?: string; keepDays?: number; dump?: boolean; dumpKeepDays?: number; lang?: string };
const local: Settings = JSON.parse(await readFile(cfgPath, "utf8"));
setLang(opt("lang") ?? local.lang);
// The profile supplies default rules; anything set in config.local.json wins.
const profileName = opt("profile") ?? local.profile ?? "software";
let profile;
try { profile = useProfile(profileName); } catch (e: any) { console.error(e.message); process.exit(1); }
const cfg: Settings = { ...(profile.defaults as object), ...local, profile: profileName } as Settings;
// A one-off --profile run that differs from your config writes to out/<profile>/ so your own report stays as it is.
const oneOff = profileName !== (local.profile ?? "software");
const OUT = oneOff ? `out/${profileName}` : "out";
const CACHE = oneOff ? `.cache/seen-${profileName}.json` : ".cache/seen.json";
const companiesFile = resolve(ROOT, cfg.companies ?? `profiles/${profileName}/companies.json`);
const resumePath = resolve(ROOT, opt("resume") ?? cfg.resume);

async function loadResume(): Promise<Resume> {
  if (!existsSync(resumePath)) {
    console.error(L(`找不到简历：${resumePath}\n在 config.local.json 里改 "resume"，或者用 --resume <路径>。`, `Resume not found: ${resumePath}\nSet "resume" in config.local.json or pass --resume <path>.`));
    process.exit(1);
  }
  const text = await readResume(resumePath);
  return { text, skills: findSkills(text) };
}

const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", r: "\x1b[0m" };
const color = (l: string) => (l === "Strong" ? C.g : l === "Good" ? C.c : C.y);

const trackedTag = (r: Result) => r.tracked ? `[${statusLabel(r.tracked.status)}${r.tracked.applied ? " " + r.tracked.applied.slice(5).replace("-", "/") : ""}]` : "";

function explain(r: Result, isNew = false) {
  const j = r.job;
  console.log(`${C.b}${color(r.label)}${r.score.toString().padStart(3)} ${r.label.padEnd(7)}${C.r} ${C.b}${j.company}${C.r} · ${j.title}${isNew ? ` ${C.y}NEW${C.r}` : ""}${r.tracked ? ` ${C.c}${trackedTag(r)}${C.r}` : ""}`);
  console.log(`    ${C.dim}${[r.where || j.location || L("地点未知", "location unknown"), j.pay, j.posted && L(`发布 ${j.posted}`, `posted ${j.posted}`), r.years !== null ? L(`要求 ${r.years}+ 年`, `${r.years}+ yrs`) : ""].filter(Boolean).join(" · ")}${C.r}`);
  console.log(`    ${j.url}`);
  const hit = `${r.required.length - r.missingRequired.length}/${r.required.length}`;
  console.log(`    ${L(`简历 ${r.resumeScore}（必须项对上 ${hit}）· 条件 ${r.fitScore}`, `resume ${r.resumeScore} (${hit} required) · fit ${r.fitScore}`)}`);
  if (r.matched.length) console.log(`    ${C.g}✓ ${L("对上", "have")}${C.r} ${r.matched.join(", ")}`);
  if (r.missingRequired.length) console.log(`    ${C.y}✗ ${L("缺（必须）", "missing (required)")}${C.r} ${r.missingRequired.join(", ")}`);
  if (r.missingNice.length) console.log(`    ${C.dim}~ ${L("缺（加分项）", "missing (nice to have)")} ${r.missingNice.join(", ")}${C.r}`);
  if (r.keywords.length) console.log(`    ${C.c}${L("简历里没有的词", "not on your resume")}${C.r} ${r.keywords.join(", ")}`);
  for (const f of r.flags) console.log(`    ${C.y}!${C.r} ${f}`);
  if (r.dropped) console.log(`    ${C.y}${L("会被 scan 过滤掉", "scan would filter this out")}: ${r.dropped}${C.r}`);
}

// What the fit score looks at, for report footers.
function fitWhat(): string {
  return [L("级别", "level"), L("地点", "location"), profile.bonus ? bonusLabel() : "", cfg.graduation ? L("毕业时间", "graduation window") : ""].filter(Boolean).join(L("、", ", "));
}

function toMarkdown(rs: Result[], seen: Set<string>, date: string, total: number, errors: string[]): string {
  const rows = rs.map(r => {
    const j = r.job;
    const esc = (s: string) => s.replace(/\|/g, "/");
    return `| ${r.score} ${r.label} | ${r.resumeScore} (${r.required.length - r.missingRequired.length}/${r.required.length}) | ${r.fitScore} | ${esc(j.company)} | [${esc(j.title)}](${j.url})${seen.has(j.id) ? "" : " **NEW**"}${r.tracked ? " " + trackedTag(r) : ""} | ${esc(r.where)} | ${esc(j.pay || "")} | ${j.posted} | ${r.matched.join(", ")} | ${r.missingRequired.join(", ")} | ${r.missingNice.join(", ")} | ${esc(r.keywords.join(", "))} | ${esc(r.flags.join("; "))} |`;
  });
  const head = L(
    `# 职位扫描 ${date}\n\n抓取 ${total} 个职位，符合条件 ${rs.length} 个。\n\n总分 = 60% 简历分 + 40% 条件分。简历分看你的简历覆盖了多少职位要求的技能（必须项占 75，加分项占 25）；条件分看${fitWhat()}。\n\n| 总分 | 简历 | 条件 | 公司 | 职位 | 地点 | 薪资 | 发布 | 对上的技能 | 缺（必须） | 缺（加分项） | 简历里没有的词 | 注意 |`,
    `# Job scan ${date}\n\nFetched ${total} postings, ${rs.length} match.\n\nTotal = 60% resume score + 40% fit score. Resume score: how much of the posting's skills your resume covers (required 75, nice-to-have 25). Fit score: ${fitWhat()}.\n\n| Total | Resume | Fit | Company | Role | Location | Pay | Posted | Skills you have | Missing (required) | Missing (nice) | Not on your resume | Notes |`);
  const failed = errors.length ? `\n## ${L("没抓到的公司", "Boards that failed")}\n\n${errors.map(e => `- ${e}`).join("\n")}\n` : "";
  return `${head}\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n${failed}`;
}

async function scan() {
  const resume = await loadResume();
  const { companies } = JSON.parse(await readFile(companiesFile, "utf8"));
  const only = opt("company")?.toLowerCase();
  const list = only ? companies.filter((c: string[]) => c[0].toLowerCase().includes(only)) : companies;
  const errors: string[] = [];
  process.stderr.write(L(`正在抓 ${list.length} 家公司的职位…\n`, `Fetching ${list.length} job boards…\n`));
  const jobs: Job[] = await fetchAll(list, e => errors.push(e), {
    searchTerms: profile.searchTerms ?? [],
    titleOk: t => flag("all") || !titleAllowed(t, cfg),
    placeOk: loc => flag("all") || flag("anywhere") || !NON_US.test(loc) || US.test(loc) || cfg.locations.cities.some(c => loc.toLowerCase().includes(c)),
  });
  const all = jobs.map(j => score(j, resume, cfg, { keepAll: flag("anywhere"), loose: flag("loose") }));
  // Mark postings already in the online tracker; hide the ones you are done with (rejected, closed, skipped).
  const tracked = await loadTracked(ROOT, (cfg as any).tracker);
  if (tracked) {
    const lookup = makeLookup(tracked.jobs);
    for (const r of all) { const t = lookup(r.job); if (t) r.tracked = { status: t.status, applied: t.applied }; }
  }
  const kept = all.filter(r => (flag("all") || !r.dropped) && r.score >= (flag("all") ? 0 : cfg.minScore))
    .filter(r => flag("all") || !(r.tracked && FINISHED.has(r.tracked.status)))
    .sort((a, b) => b.score - a.score || b.job.posted.localeCompare(a.job.posted));

  // First-seen date per job. A job stays NEW for the whole day it first appeared.
  const date = new Date().toLocaleDateString("en-CA");
  const cacheFile = resolve(ROOT, CACHE);
  const raw = existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, "utf8")) : {};
  const firstSeen: Record<string, string> = Array.isArray(raw) ? Object.fromEntries(raw.map((id: string) => [id, "2000-01-01"])) : raw;
  const isNewId = (id: string) => !firstSeen[id] || firstSeen[id] >= date;
  const newIds = new Set(kept.filter(r => !r.tracked && isNewId(r.job.id)).map(r => r.job.id));
  const isNew = (id: string) => newIds.has(id);
  const seen = new Set(kept.filter(r => !isNew(r.job.id)).map(r => r.job.id));
  const top = parseInt(opt("top") ?? "30", 10);
  for (const r of kept.slice(0, top)) { explain(r, isNew(r.job.id)); console.log(); }

  await mkdir(resolve(ROOT, OUT), { recursive: true });
  await mkdir(resolve(ROOT, ".cache"), { recursive: true });
  const md = resolve(ROOT, OUT, `${date}.md`);
  await writeFile(md, toMarkdown(kept, seen, date, jobs.length, errors));
  await writeFile(resolve(ROOT, OUT, `${date}.json`), JSON.stringify(kept.map(r => ({ ...r, job: { ...r.job, text: undefined }, new: isNew(r.job.id) })), null, 2));
  const page = resolve(ROOT, OUT, "report.html");
  await writeFile(page, toHtml(kept.map(r => ({ ...r, isNew: isNew(r.job.id) })), { date, fetched: jobs.length, companies: list.length, errors, trackedFile: tracked?.file ?? "", localLabel: cfg.locations.label || "Local", fitWhat: fitWhat() }));
  if (flag("dump") || cfg.dump) await dumpAll(jobs, date);
  for (const r of kept) firstSeen[r.job.id] ??= date;
  await writeFile(cacheFile, JSON.stringify(firstSeen));

  // Keep dated reports for keepDays days (report.html is always overwritten).
  const keep = cfg.keepDays ?? 7;
  const cutoff = new Date(Date.now() - keep * 86400000).toLocaleDateString("en-CA");
  for (const f of await readdir(resolve(ROOT, OUT))) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.(md|json)$/);
    if (m && (keep <= 0 ? m[1] !== date || keep < 0 : m[1] < cutoff)) await unlink(resolve(ROOT, OUT, f));
  }

  const shown = Math.min(top, kept.length), inRun = kept.filter(r => r.tracked).length;
  console.log(`${C.b}${L(`抓取 ${jobs.length} 个职位 → 符合条件 ${kept.length} 个`, `Fetched ${jobs.length} postings → ${kept.length} match`)}${C.r}${L(`（终端只显示前 ${shown} 个）`, ` (showing top ${shown})`)}`);
  console.log(L(`网页报告：${page}（双击打开，或运行 npm run open）`, `HTML report: ${page} (npm run open)`));
  console.log(L(`文字报告：${md}`, `Markdown report: ${md}`));
  if (tracked) console.log(L(`追踪表：读了 ${tracked.file}（${tracked.jobs.length} 个职位，这次结果里出现 ${inRun} 个）`, `Tracker: read ${tracked.file} (${tracked.jobs.length} postings, ${inRun} in this run)`));
  else console.log(`${C.dim}${L("没找到 tracked.json。想在报告里标出已投的职位，去追踪表点「导出给 job-radar」。", "No tracked.json found. Export one from your tracker to label postings you already track.")}${C.r}`);
  if (errors.length) console.log(`${C.y}${L(`${errors.length} 家公司没抓到，详见报告末尾。`, `${errors.length} board(s) failed; see the end of the report.`)}${C.r}`);
}

// Write every fetched posting (not just the ones that pass the filters) as one JSON object per line.
// Used by echolocate for semantic search and trends. Kept for dumpKeepDays days (default 30).
async function dumpAll(jobs: Job[], date: string) {
  // software keeps out/all/; other profiles get out/all/<profile>/ so dumps never mix (echolocate reads these).
  const dir = resolve(ROOT, "out", "all", ...(profileName === "software" ? [] : [profileName]));
  await mkdir(dir, { recursive: true });
  const seenIds = new Set<string>();
  const lines: string[] = [];
  for (const j of jobs) {
    if (seenIds.has(j.id)) continue;
    seenIds.add(j.id);
    const { id, company, title, location, remote, url, posted, pay, text } = j;
    lines.push(JSON.stringify({ id, company, title, location, remote, url, posted, pay, description: text }));
  }
  const file = resolve(dir, `${date}.jsonl`);
  await writeFile(file, lines.join("\n") + "\n");
  const keep = cfg.dumpKeepDays ?? 30;
  const cutoff = new Date(Date.now() - keep * 86400000).toLocaleDateString("en-CA");
  for (const f of await readdir(dir)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (m && keep >= 0 && m[1] < cutoff) await unlink(resolve(dir, f));
  }
  console.log(L(`全量导出：${file}（${lines.length} 个职位，保留 ${keep} 天）`, `Full dump: ${file} (${lines.length} postings, kept ${keep} days)`));
  return { file, postings: lines.length };
}

// npm run dump -- --profile <name>: fetch and write the full dump only (no resume, no scoring).
// The last line is JSON for programs that call this (echolocate).
async function dumpOnly() {
  try {
    const { companies } = JSON.parse(await readFile(companiesFile, "utf8"));
    const errors: string[] = [];
    process.stderr.write(L(`正在抓 ${companies.length} 家公司的职位（${profileName}）…\n`, `Fetching ${companies.length} job boards (${profileName})…\n`));
    const jobs = await fetchAll(companies, e => errors.push(e), {
      searchTerms: profile.searchTerms ?? [],
      titleOk: t => !titleAllowed(t, cfg),
      placeOk: loc => !NON_US.test(loc) || US.test(loc),
    });
    const { file, postings } = await dumpAll(jobs, new Date().toLocaleDateString("en-CA"));
    console.log(JSON.stringify({ ok: true, profile: profileName, file, postings, failedBoards: errors.length, failed: errors.slice(0, 20) }));
  } catch (e: any) {
    console.log(JSON.stringify({ ok: false, profile: profileName, error: e.message }));
    process.exit(1);
  }
}

// A posting from a URL, or from a saved .txt file (first line = title).
async function getJob(target: string): Promise<Job> {
  if (/^https?:\/\//.test(target)) return fetchOne(target);
  const text = await readFile(target, "utf8");
  const company = opt("company") ?? "(pasted)";
  return { id: target, company, title: text.split("\n")[0].slice(0, 120), location: "", remote: /remote/i.test(text), url: target, posted: "", pay: "", text };
}

async function match() {
  const target = args[1];
  if (!target) { console.error(L("用法：npm run match -- <职位链接 或 .txt 文件>", "Usage: npm run match -- <posting URL or .txt file>")); process.exit(1); }
  const resume = await loadResume();
  const job = await getJob(target);
  const r = score(job, resume, cfg, { keepAll: true });
  explain(r);
  console.log(`\n${C.dim}${L(
    `总分 = 60% 简历分 + 40% 条件分。简历分：必须项技能覆盖 75 + 加分项覆盖 25${profile.gapPenalty?.length ? "，要求里有你没写过的语言每个 -10" : ""}。条件分：级别 50 + 地点 30${profile.bonus ? ` + ${bonusLabel()} 20` : ""}${cfg.graduation ? "，毕业时间不符 -40" : ""}。\n「简历里没有的词」是职位要求里出现、你简历里一次都没出现的词，改简历时可以参考。只是关键词规则，最终请自己读 JD。`,
    `Total = 60% resume + 40% fit. Resume: required-skill coverage 75 + nice-to-have 25${profile.gapPenalty?.length ? ", -10 per required language you lack" : ""}. Fit: level 50 + location 30${profile.bonus ? ` + ${bonusLabel()} 20` : ""}${cfg.graduation ? ", -40 if the graduation window excludes you" : ""}.\n"Not on your resume" lists terms from the requirements that never appear in your resume. Keyword rules only; read the posting yourself.`)}${C.r}`);
}

async function tailor() {
  const target = args[1];
  if (!target || target.startsWith("--")) { console.error(L("用法：npm run tailor -- <职位链接 或 .txt 文件> [--bank 素材库.json] [--no-pdf]", "Usage: npm run tailor -- <posting URL or .txt file> [--bank bank.json] [--no-pdf]")); process.exit(1); }
  const T = await import("./tailor.ts");
  const bankPath = resolve(ROOT, opt("bank") ?? (cfg as any).bank ?? "resume.local.json");
  if (!existsSync(bankPath)) {
    console.error(L(`找不到素材库：${bankPath}\n复制 resume.example.json 为 resume.local.json 并填上你自己的经历，或者在 config.local.json 里设 "bank"。`, `Bullet bank not found: ${bankPath}\nCopy resume.example.json to resume.local.json and fill in your own experience, or set "bank" in config.local.json.`));
    process.exit(1);
  }
  const bank = await T.loadBank(bankPath);
  const job = await getJob(target);
  if (/^[a-z]/.test(job.company)) job.company = job.company[0].toUpperCase() + job.company.slice(1); // board slugs are lowercase
  const before = existsSync(resumePath) ? await loadResume() : null;
  const base = score(job, before ?? { text: "", skills: new Set() }, cfg, { keepAll: true });
  const want = { required: base.required, nice: base.nice, keywords: base.keywords, title: job.title };
  const chosen = T.choose(bank, want);

  const dir = resolve(ROOT, opt("out") ?? `out/tailored/${T.slug(job.company)}-${T.slug(job.title)}`);
  const stem = `${bank.name.replace(/\(.*?\)/g, "").trim().replace(/\W+/g, "_")}_Resume_${job.company.replace(/\W+/g, "_")}`;
  const htmlFile = resolve(dir, `${stem}.html`), pdfFile = resolve(dir, `${stem}.pdf`);
  const dropped: string[] = [];
  let pages = 0;
  const chrome = flag("no-pdf") ? null : T.findChrome((cfg as any).chrome);
  await T.writeOut(dir, { [`${stem}.html`]: T.toResumeHtml(chosen) });
  if (chrome) {
    for (let i = 0; i < 30; i++) {
      pages = await T.htmlToPdf(chrome, htmlFile, pdfFile);
      if (pages <= 1) break;
      const gone = T.dropOne(chosen, bank);
      if (!gone) break;
      dropped.push(gone);
      await T.writeOut(dir, { [`${stem}.html`]: T.toResumeHtml(chosen) });
    }
  }
  const text = T.toText(chosen);
  const after = score(job, { text, skills: findSkills(text) }, cfg, { keepAll: true });
  const lacking = after.missingRequired;
  const notes = [
    `# ${job.company} · ${job.title}`, job.url, "",
    `- ${L("简历分", "Resume score")}: ${before ? `${base.resumeScore} → ` : ""}${after.resumeScore}`,
    `- ${L("对上的技能", "Matched skills")}: ${after.matched.join(", ") || "-"}`,
    `- ${L("素材库里没有的必须项（没有写进去）", "Required skills your bank doesn't cover (not added)")}: ${lacking.join(", ") || "-"}`,
    `- ${L("缺的加分项", "Missing nice-to-haves")}: ${after.missingNice.join(", ") || "-"}`,
    `- ${L("职位里常见、你的简历里没有的词", "Posting terms not in this resume")}: ${after.keywords.join(", ") || "-"}`,
    chrome ? `- PDF: ${pages} ${L("页", pages === 1 ? "page" : "pages")}` : `- PDF: ${L("没有生成（没找到 Chrome，或用了 --no-pdf）", "not made (no Chrome found, or --no-pdf)")}`,
    "", `## ${L("为了一页删掉的", "Dropped to fit one page")}`, ...(dropped.length ? dropped.map(d => `- ${d}`) : ["-"]),
    "", `## ${L("选上的内容（按分数）", "Chosen bullets (by score)")}`,
    ...chosen.sections.flatMap(s => s.entries.flatMap(e => [`### ${e.entry.title}`, ...e.bullets.map(b => `- [${b.score}${b.pin ? L("，固定", ", pinned") : ""}] ${b.text.replace(/\*\*/g, "")}`)])),
  ].join("\n");
  await T.writeOut(dir, { "notes.md": notes + "\n" });

  console.log(`${C.b}${job.company}${C.r} · ${job.title}`);
  console.log(`  ${L("简历分", "resume score")} ${before ? `${base.resumeScore} → ` : ""}${C.b}${after.resumeScore}${C.r}${before ? C.dim + L(`（原简历：${resumePath}）`, ` (vs ${resumePath})`) + C.r : ""}`);
  if (after.matched.length) console.log(`  ${C.g}✓${C.r} ${after.matched.join(", ")}`);
  if (lacking.length) console.log(`  ${C.y}✗ ${L("素材库里没有，没写进去", "not in your bank, so not added")}${C.r} ${lacking.join(", ")}`);
  if (dropped.length) console.log(`  ${C.dim}${L(`为了一页删了 ${dropped.length} 条`, `dropped ${dropped.length} bullet(s) to fit one page`)}${C.r}`);
  if (chrome && pages > 1) console.log(`  ${C.y}! ${L(`还是 ${pages} 页：把素材库里条目的 min 调小，或者删掉一些`, `still ${pages} pages: lower "min" on some entries or trim the bank`)}${C.r}`);
  if (!chrome && !flag("no-pdf")) console.log(`  ${C.y}! ${L("没找到 Chrome：用浏览器打开 HTML 打印成 PDF，或在 config.local.json 里设 \"chrome\"", "Chrome not found: open the HTML and print to PDF, or set \"chrome\" in config.local.json")}${C.r}`);
  console.log(`  ${chrome ? pdfFile : htmlFile}`);
  console.log(`  ${resolve(dir, "notes.md")}`);
  console.log(`\n${C.dim}${L("只从素材库里挑选和排序，不会编新内容。投之前自己读一遍。", "Only picks and orders text from your bank; nothing new is written. Read it before you send it.")}${C.r}`);
}

async function showSkills() {
  const { skills } = await loadResume();
  console.log(L(`从简历里认出的技能（${resumePath}）：`, `Skills found in your resume (${resumePath}):`) + `\n${[...skills].join(", ")}`);
  console.log("\n" + L("如果漏了，去 src/skills.ts 加别名，或者在简历里写明。", "Missing one? Add an alias in src/skills.ts or spell it out in your resume."));
}

function showProfiles() {
  if (flag("json")) { console.log(JSON.stringify(listProfiles())); return; }
  console.log(L("可选的 profile（在 config.local.json 里设 \"profile\"）：", "Career profiles (set \"profile\" in config.local.json):"));
  for (const p of listProfiles()) console.log(`  ${p.name === profileName ? "*" : " "} ${p.name.padEnd(10)} ${p.draft ? L("[草稿] ", "[draft] ") : ""}${p.description}`);
  console.log(L(`\n加一个新的：复制 ${PROFILES}/software 改名，再改里面的 profile.json 和 companies.json。`, `\nAdd one: copy ${PROFILES}/software to a new folder and edit its profile.json and companies.json.`));
}

// Open the HTML report with the system's default browser.
async function openReport() {
  const page = resolve(ROOT, OUT, "report.html");
  if (!existsSync(page)) { console.error(L("还没有报告，先运行 npm run scan。", "No report yet. Run npm run scan first.")); process.exit(1); }
  const { spawn } = await import("node:child_process");
  const [c, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", page]] : process.platform === "darwin" ? ["open", [page]] : ["xdg-open", [page]];
  spawn(c, a as string[], { stdio: "ignore", detached: true }).unref();
}

if (cmd === "scan") await scan();
else if (cmd === "profiles") showProfiles();
else if (cmd === "dump") await dumpOnly();
else if (cmd === "new-profile") { const { newProfile } = await import("./newprofile.ts"); await newProfile(args.slice(1)); }
else if (cmd === "add-company") { const { addCompany } = await import("./newprofile.ts"); await addCompany(args.slice(1)); }
else if (cmd === "open") await openReport();
else if (cmd === "match") await match();
else if (cmd === "tailor") await tailor();
else if (cmd === "skills") await showSkills();
else console.log(L(`用法：
  npm run scan                      抓所有公司，按匹配度排序，写报告到 out/
  npm run scan -- --top 50          终端多显示几个
  npm run scan -- --company quora   只抓某家公司
  npm run scan -- --loose           也显示没写级别/年限的职位
  npm run scan -- --anywhere        不限地点
  npm run scan -- --all             不过滤，全部打分（调试用）
  npm run scan -- --dump            另外把抓到的所有职位写到 out/all/日期.jsonl
  npm run match -- <链接或txt>      给单个职位打分
  npm run tailor -- <链接或txt>     从素材库为这个职位生成一页简历（HTML + PDF）
  npm run skills                    看简历里认出了哪些技能
  npm run profiles                  看有哪些职业 profile
  npm run setup                     回答几个问题，生成 config.local.json
  任何命令加 --profile <名字> 临时换一个 profile
  任何命令加 --lang en 或 --lang zh 切换输出语言`, `Usage:
  npm run scan                      fetch every board, rank, write reports to out/
  npm run scan -- --top 50          show more results in the terminal
  npm run scan -- --company quora   one company only
  npm run scan -- --loose           include postings with no level or years stated
  npm run scan -- --anywhere        ignore location
  npm run scan -- --all             no filtering (debugging)
  npm run scan -- --dump            also write every fetched posting to out/all/<date>.jsonl
  npm run match -- <URL or .txt>    score one posting
  npm run tailor -- <URL or .txt>   build a one-page resume for it from your bullet bank (HTML + PDF)
  npm run skills                    show skills found in your resume
  npm run profiles                  list career profiles
  npm run setup                     answer a few questions to write config.local.json
  Add --profile <name> to use another profile for one run.
  Add --lang en or --lang zh to any command to switch the output language.`));
