// `npm run applied -- <posting>`: add a posting you applied to as a new row in your tracker sheet,
// through the Apps Script receiver in tracker/apps-script.gs. Score, link, location and pay come from
// job-radar; the resume version is filled when out/tailored/ has one for that company.

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Job } from "./sources.ts";
import type { Result } from "./score.ts";
import { L } from "./i18n.ts";

type Ctx = {
  args: string[]; opt: (n: string) => string | undefined; root: string;
  cfg: { trackerWebhook?: string; trackerToken?: string };
  getJob: (t: string) => Promise<Job>; scoreJob: (j: Job) => Promise<Result>;
};

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// A tailored resume made for this company (out/tailored/<company>-<title>/) → its label, the company name.
export function resumeLabel(root: string, company: string): string {
  const dir = resolve(root, "out/tailored");
  if (!company || !existsSync(dir)) return "";
  return readdirSync(dir).some(d => d.startsWith(slug(company) + "-")) ? company : "";
}

export async function applied(ctx: Ctx) {
  const { args, opt, cfg } = ctx;
  const target = args[1] && !args[1].startsWith("--") ? args[1] : "";
  if (!cfg.trackerWebhook || !cfg.trackerToken) {
    console.error(L(
      "还没接上表格。按 README 的「投递追踪表」一节装好 Apps Script，然后在 config.local.json 里设 \"trackerWebhook\" 和 \"trackerToken\"。",
      "No tracker sheet connected. Install the Apps Script from tracker/apps-script.gs (see README), then set \"trackerWebhook\" and \"trackerToken\" in config.local.json."));
    process.exit(1);
  }
  let job: Job | null = null, r: Result | null = null;
  if (target) {
    try { job = await ctx.getJob(target); r = await ctx.scoreJob(job); }
    catch (e) {
      if (!opt("company") || !opt("role")) {
        console.error(L(
          `读不到这个职位（${(e as Error).message}）。job-radar 读不到的网站，加上公司和职位：\n  npm run applied -- "${target}" --company "公司" --role "职位"`,
          `Could not read this posting (${(e as Error).message}). For sites job-radar can't read, give the company and role:\n  npm run applied -- "${target}" --company "Name" --role "Title"`));
        process.exit(1);
      }
    }
  } else if (!opt("company") || !opt("role")) {
    console.error(L("用法：npm run applied -- <职位链接> [--resume 版本] [--status applied]\n  或者：npm run applied -- --company \"公司\" --role \"职位\" [--link 链接]",
      "Usage: npm run applied -- <posting URL> [--resume Name] [--status applied]\n   or: npm run applied -- --company \"Name\" --role \"Title\" [--link URL]"));
    process.exit(1);
  }
  const company = opt("company") ?? job?.company ?? "";
  const row: Record<string, string | number> = {
    Company: company,
    Role: opt("role") ?? job?.title ?? "",
    Score: r ? r.score : "",
    Status: (opt("status") ?? "applied").toLowerCase(),
    Applied: opt("date") ?? today(),
    "Resume used": opt("resume") ?? resumeLabel(ctx.root, company),
    Location: job ? (job.remote ? `Remote${job.location ? " / " + job.location : ""}` : job.location) : "",
    Pay: job?.pay ?? "",
    Link: opt("link") ?? (/^https?:\/\//.test(target) ? target : ""),
    Notes: opt("note") ?? "",
  };
  const res = await fetch(cfg.trackerWebhook, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ token: cfg.trackerToken, row }), redirect: "follow" });
  const text = await res.text();
  let d: any; try { d = JSON.parse(text); } catch { d = { ok: false, error: `${res.status} ${text.slice(0, 120)}` }; }
  if (!d.ok) { console.error(L(`表格没写进去：${d.error}`, `The sheet did not accept it: ${d.error}`)); process.exit(1); }
  console.log(L(
    `${d.updated ? "已更新" : "已加到表格"}：${row.Company} · ${row.Role}${row.Score !== "" ? ` · ${row.Score} 分` : ""} · ${row.Status} ${row.Applied}${row["Resume used"] ? ` · 简历 ${row["Resume used"]}` : " · 简历版本请在表格里选"}`,
    `${d.updated ? "Updated" : "Added"}: ${row.Company} · ${row.Role}${row.Score !== "" ? ` · score ${row.Score}` : ""} · ${row.Status} ${row.Applied}${row["Resume used"] ? ` · resume ${row["Resume used"]}` : " · pick the resume version in the sheet"}`));
}
