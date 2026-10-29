// Reads tracked.json exported from the online application tracker ("导出给 job-radar"),
// so the report can show which postings you are already tracking or have applied to.

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Job } from "./sources.ts";

export type Tracked = { company: string; role: string; url: string; status: string; applied: string; followUp: string };

export const STATUS_LABEL: Record<string, string> = {
  saved: "待投", applied: "已投", oa: "笔试/OA", interview: "面试中",
  offer: "Offer", rejected: "被拒", closed: "职位已关", skip: "不投了",
};
// Statuses that mean "done with this one": hidden from the report.
export const FINISHED = new Set(["rejected", "closed", "skip"]);

// Finds the newest tracked*.json in the project folder and ~/Downloads (browsers add " (1)" to repeats).
export async function loadTracked(root: string): Promise<{ file: string; jobs: Tracked[] } | null> {
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
