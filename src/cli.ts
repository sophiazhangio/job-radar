#!/usr/bin/env node
// job-radar: pull entry-level postings from public job boards and score them against your resume.
//
//   node src/cli.ts scan [--top 30] [--all] [--anywhere] [--company Quora]
//   node src/cli.ts match <job URL or .txt file>
//   node src/cli.ts skills

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readResume } from "./resume.ts";
import { findSkills } from "./skills.ts";
import { fetchAll, fetchOne, type Job } from "./sources.ts";
import { score, type Config, type Result, type Resume } from "./score.ts";
import { toHtml } from "./html.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const cfg: Config & { resume: string; keepDays?: number } = JSON.parse(await readFile(resolve(ROOT, "config.json"), "utf8"));
const resumePath = resolve(ROOT, opt("resume") ?? cfg.resume);

async function loadResume(): Promise<Resume> {
  if (!existsSync(resumePath)) {
    console.error(`找不到简历：${resumePath}\n在 config.json 里改 "resume"，或者用 --resume <路径>。`);
    process.exit(1);
  }
  const text = await readResume(resumePath);
  return { text, skills: findSkills(text) };
}

const C = { dim: "\x1b[2m", b: "\x1b[1m", g: "\x1b[32m", y: "\x1b[33m", c: "\x1b[36m", r: "\x1b[0m" };
const color = (l: string) => (l === "Strong" ? C.g : l === "Good" ? C.c : C.y);

function explain(r: Result, isNew = false) {
  const j = r.job;
  console.log(`${C.b}${color(r.label)}${r.score.toString().padStart(3)} ${r.label.padEnd(7)}${C.r} ${C.b}${j.company}${C.r} · ${j.title}${isNew ? ` ${C.y}NEW${C.r}` : ""}`);
  console.log(`    ${C.dim}${[r.where || j.location || "地点未知", j.pay, j.posted && `发布 ${j.posted}`, r.years !== null ? `要求 ${r.years}+ 年` : ""].filter(Boolean).join(" · ")}${C.r}`);
  console.log(`    ${j.url}`);
  console.log(`    简历 ${r.resumeScore}（必须项对上 ${r.required.length - r.missingRequired.length}/${r.required.length}）· 条件 ${r.fitScore}`);
  if (r.matched.length) console.log(`    ${C.g}✓ 对上${C.r} ${r.matched.join(", ")}`);
  if (r.missingRequired.length) console.log(`    ${C.y}✗ 缺（必须）${C.r} ${r.missingRequired.join(", ")}`);
  if (r.missingNice.length) console.log(`    ${C.dim}~ 缺（加分项）${r.missingNice.join(", ")}${C.r}`);
  if (r.keywords.length) console.log(`    ${C.c}简历里没有的词${C.r} ${r.keywords.join(", ")}`);
  for (const f of r.flags) console.log(`    ${C.y}!${C.r} ${f}`);
  if (r.dropped) console.log(`    ${C.y}会被 scan 过滤掉：${r.dropped}${C.r}`);
}

function toMarkdown(rs: Result[], seen: Set<string>, date: string, total: number, errors: string[]): string {
  const rows = rs.map(r => {
    const j = r.job;
    const esc = (s: string) => s.replace(/\|/g, "/");
    return `| ${r.score} ${r.label} | ${r.resumeScore} (${r.required.length - r.missingRequired.length}/${r.required.length}) | ${r.fitScore} | ${esc(j.company)} | [${esc(j.title)}](${j.url})${seen.has(j.id) ? "" : " **NEW**"} | ${esc(r.where)} | ${esc(j.pay || "")} | ${j.posted} | ${r.matched.join(", ")} | ${r.missingRequired.join(", ")} | ${r.missingNice.join(", ")} | ${esc(r.keywords.join(", "))} | ${esc(r.flags.join("; "))} |`;
  });
  return `# 职位扫描 ${date}\n\n抓取 ${total} 个职位，符合条件 ${rs.length} 个。\n\n总分 = 60% 简历分 + 40% 条件分。简历分看你的简历覆盖了多少职位要求的技能（必须项占 75，加分项占 25）；条件分看级别、地点、AI 相关、毕业时间。\n\n| 总分 | 简历 | 条件 | 公司 | 职位 | 地点 | 薪资 | 发布 | 对上的技能 | 缺（必须） | 缺（加分项） | 简历里没有的词 | 注意 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n${errors.length ? `\n## 没抓到的公司\n\n${errors.map(e => `- ${e}`).join("\n")}\n` : ""}`;
}

async function scan() {
  const resume = await loadResume();
  const { companies } = JSON.parse(await readFile(resolve(ROOT, "companies.json"), "utf8"));
  const only = opt("company")?.toLowerCase();
  const list = only ? companies.filter((c: string[]) => c[0].toLowerCase().includes(only)) : companies;
  const errors: string[] = [];
  process.stderr.write(`正在抓 ${list.length} 家公司的职位…\n`);
  const jobs: Job[] = await fetchAll(list, e => errors.push(e));
  const all = jobs.map(j => score(j, resume, cfg, { keepAll: flag("anywhere"), loose: flag("loose") }));
  const kept = all.filter(r => (flag("all") || !r.dropped) && r.score >= (flag("all") ? 0 : cfg.minScore))
    .sort((a, b) => b.score - a.score || b.job.posted.localeCompare(a.job.posted));

  // First-seen date per job. A job stays NEW for the whole day it first appeared.
  const date = new Date().toLocaleDateString("en-CA");
  const cacheFile = resolve(ROOT, ".cache/seen.json");
  const raw = existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, "utf8")) : {};
  const firstSeen: Record<string, string> = Array.isArray(raw) ? Object.fromEntries(raw.map((id: string) => [id, "2000-01-01"])) : raw;
  const isNew = (id: string) => !firstSeen[id] || firstSeen[id] >= date;
  const seen = new Set(kept.filter(r => !isNew(r.job.id)).map(r => r.job.id));
  const top = parseInt(opt("top") ?? "30", 10);
  for (const r of kept.slice(0, top)) { explain(r, isNew(r.job.id)); console.log(); }

  await mkdir(resolve(ROOT, "out"), { recursive: true });
  await mkdir(resolve(ROOT, ".cache"), { recursive: true });
  const md = resolve(ROOT, `out/${date}.md`);
  await writeFile(md, toMarkdown(kept, seen, date, jobs.length, errors));
  await writeFile(resolve(ROOT, `out/${date}.json`), JSON.stringify(kept.map(r => ({ ...r, job: { ...r.job, text: undefined }, new: isNew(r.job.id) })), null, 2));
  const page = resolve(ROOT, "out/report.html");
  await writeFile(page, toHtml(kept.map(r => ({ ...r, isNew: isNew(r.job.id) })), { date, fetched: jobs.length, companies: list.length, errors }));
  for (const r of kept) firstSeen[r.job.id] ??= date;
  await writeFile(cacheFile, JSON.stringify(firstSeen));

  // Keep dated reports for keepDays days (report.html is always overwritten).
  const keep = cfg.keepDays ?? 7;
  const cutoff = new Date(Date.now() - keep * 86400000).toLocaleDateString("en-CA");
  for (const f of await readdir(resolve(ROOT, "out"))) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.(md|json)$/);
    if (m && (keep <= 0 ? m[1] !== date || keep < 0 : m[1] < cutoff)) await unlink(resolve(ROOT, "out", f));
  }

  console.log(`${C.b}抓取 ${jobs.length} 个职位 → 符合条件 ${kept.length} 个${C.r}（终端只显示前 ${Math.min(top, kept.length)} 个）`);
  console.log(`网页报告：${page}（双击打开，或运行 npm run open）`);
  console.log(`文字报告：${md}`);
  if (errors.length) console.log(`${C.y}${errors.length} 家公司没抓到，详见报告末尾。${C.r}`);
}

async function match() {
  const target = args[1];
  if (!target) { console.error("用法：npm run match -- <职位链接 或 .txt 文件>"); process.exit(1); }
  const resume = await loadResume();
  let job: Job;
  if (/^https?:\/\//.test(target)) job = await fetchOne(target);
  else {
    const text = await readFile(target, "utf8");
    job = { id: target, company: "(pasted)", title: text.split("\n")[0].slice(0, 120), location: "", remote: /remote/i.test(text), url: target, posted: "", pay: "", text };
  }
  const r = score(job, resume, cfg, { keepAll: true });
  explain(r);
  console.log(`\n${C.dim}总分 = 60% 简历分 + 40% 条件分。简历分：必须项技能覆盖 75 + 加分项覆盖 25，要求里有你没写过的语言每个 -10。条件分：级别 50 + 地点 30 + AI 相关 20，毕业时间不符 -40。\n「简历里没有的词」是职位要求里反复出现、你简历里一次都没出现的词，可以交给改简历的会话参考。只是关键词规则，最终请自己读 JD。${C.r}`);
}

async function showSkills() {
  const { skills } = await loadResume();
  console.log(`从简历里认出的技能（${resumePath}）：\n${[...skills].join(", ")}`);
  console.log(`\n如果漏了，去 src/skills.ts 加别名，或者在简历里写明。`);
}

if (cmd === "scan") await scan();
else if (cmd === "match") await match();
else if (cmd === "skills") await showSkills();
else console.log(`用法：
  npm run scan                      抓所有公司，按匹配度排序，写报告到 out/
  npm run scan -- --top 50          终端多显示几个
  npm run scan -- --company quora   只抓某家公司
  npm run scan -- --loose           也显示没写级别/年限的职位
  npm run scan -- --anywhere        不限地点
  npm run scan -- --all             不过滤，全部打分（调试用）
  npm run match -- <链接或txt>      给单个职位打分
  npm run skills                    看简历里认出了哪些技能`);
