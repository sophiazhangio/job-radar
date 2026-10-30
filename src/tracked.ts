// Reads tracked.json exported from an application tracker,
// so the report can show which postings you are already tracking or have applied to.

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Job } from "./sources.ts";
import { L } from "./i18n.ts";

export type Tracked = { company: string; role: string; url: string; status: string; applied: string; followUp: string };

const STATUS: Record<string, [string, string]> = {
  saved: ["待投", "Saved"], applied: ["已投", "Applied"], oa: ["笔试/OA", "OA"], interview: ["面试中", "Interviewing"],
  offer: ["Offer", "Offer"], rejected: ["被拒", "Rejected"], closed: ["职位已关", "Closed"], skip: ["不投了", "Skipped"],
};
export const statusLabel = (s: string) => (STATUS[s] ? L(STATUS[s][0], STATUS[s][1]) : s);
export const statusLabels = () => Object.fromEntries(Object.keys(STATUS).map(k => [k, statusLabel(k)]));
// Statuses that mean "done with this one": hidden from the report.
export const FINISHED = new Set(["rejected", "closed", "skip"]);

// A spreadsheet tracker: a Google Sheets link (shared as "anyone with the link can view"),
// any CSV URL, or a local .csv file. Headers are matched loosely (Company, Role/Title/Position,
// Link/URL, Status, Applied/Date applied, Follow-up), so a hand-made sheet works.
export async function loadSheet(src: string, root = "."): Promise<{ file: string; jobs: Tracked[] }> {
  let text: string;
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(sheetCsvUrl(src), { redirect: "follow" });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || type.includes("text/html")) throw new Error(L(
      `读不到表格（${res.status}）。在 Google 表格里点「共享」，把「一般访问权限」改成「知道链接的任何人」可查看。`,
      `Could not read the sheet (${res.status}). In Google Sheets, Share → General access → "Anyone with the link" can view.`));
    text = await res.text();
  } else text = await readFile(resolve(root, src), "utf8");
  return { file: src, jobs: sheetJobs(parseCsv(text)) };
}

// docs.google.com/spreadsheets/d/<id>/edit#gid=<gid> → the CSV export of that tab.
export function sheetCsvUrl(url: string): string {
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (!m) return url;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// 10/30/2026 or 2026-10-30 → 2026-10-30
const isoDate = (s: string) => {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : s.trim();
};

export function sheetJobs(rows: string[][]): Tracked[] {
  // The header is the first row with a Company column (a summary line above it is skipped).
  const at = Math.max(0, rows.findIndex(r => r.some(h => /^(company|公司)$/i.test(h.trim()))));
  rows = rows.slice(at);
  const head = (rows[0] || []).map(h => h.toLowerCase().trim());
  const col = (...re: RegExp[]) => head.findIndex(h => re.some(r => r.test(h)));
  const c = { company: col(/^company/, /公司/), role: col(/^(role|title|position|job)/, /职位/), url: col(/^(link|url)/, /链接/),
    status: col(/^status/, /状态/), applied: col(/^(date )?applied/, /投递/), followUp: col(/follow/, /跟进/) };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] || "").trim() : "");
  return rows.slice(1).map(r => ({
    company: get(r, c.company), role: get(r, c.role), url: get(r, c.url),
    status: get(r, c.status).toLowerCase(), applied: isoDate(get(r, c.applied)), followUp: isoDate(get(r, c.followUp)),
  })).filter(t => t.company || t.url);
}

// Finds the newest tracked*.json in the project folder and ~/Downloads (browsers add " (1)" to repeats).
// When config has "tracker" (a sheet link or .csv), that is read instead.
export async function loadTracked(root: string, sheet?: string): Promise<{ file: string; jobs: Tracked[] } | null> {
  if (sheet) {
    try { return await loadSheet(sheet, root); }
    catch (e) { console.error((e as Error).message); return null; }
  }
  const dirs = [root, join(homedir(), "Downloads")];
  let best: { file: string; mtime: number } | null = null;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try { names = await readdir(dir); } catch { continue; }
    for (const n of names.filter(n => /^tracked( ?\(\d+\))?\.json$/.test(n))) {
      const file = resolve(dir, n);
      const { mtimeMs } = await stat(file);
      if (!best || mtimeMs > best.mtime) best = { file, mtime: mtimeMs };
    }
  }
  if (!best) return null;
  try {
    const d = JSON.parse(await readFile(best.file, "utf8"));
    return { file: best.file, jobs: Array.isArray(d.jobs) ? d.jobs : [] };
  } catch { return null; }
}

// A stable key for a posting URL: the ATS job id when there is one.
export function urlKey(url: string): string {
  if (!url) return "";
  const gh = url.match(/greenhouse\.io\/.*?\/jobs\/(\d+)/) || url.match(/[?&]gh_jid=(\d+)/);
  if (gh) return "gh:" + gh[1];
  const uuid = url.match(/(?:ashbyhq|lever)\.co[m]?\/[^/]+\/([0-9a-f-]{36})/i);
  if (uuid) return "id:" + uuid[1].toLowerCase();
  return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "");
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function makeLookup(list: Tracked[]): (job: Job) => Tracked | undefined {
  const byUrl = new Map(list.filter(t => t.url).map(t => [urlKey(t.url), t]));
  const byName = new Map(list.map(t => [norm(t.company) + "|" + norm(t.role), t]));
  return job => byUrl.get(urlKey(job.url)) ?? byName.get(norm(job.company) + "|" + norm(job.title));
}
