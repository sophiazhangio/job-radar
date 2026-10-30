// Builds the local report page (out/report.html). Plain HTML + JS, no network, no AI.

import type { Result } from "./score.ts";
import { L, lang } from "./i18n.ts";
import { statusLabels } from "./tracked.ts";

export type Row = Result & { isNew: boolean };

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export function toHtml(rows: Row[], meta: { date: string; fetched: number; companies: number; errors: string[]; trackedFile: string; localLabel: string; fitWhat?: string }): string {
  const fit = meta.fitWhat ?? L("级别、地点、AI 相关、毕业时间", "level, location, AI focus, graduation window");
  // Strings the page script needs at runtime, in the chosen language.
  const t = {
    status: statusLabels(),
    companies: L(" 家公司", " boards"), fetched: L(" · 抓取 ", " · fetched "), postings: L(" 个职位", " postings"),
    failed: L(" 家没抓到", " failed"), trackedYes: L(" · 已读追踪表导出", " · tracker export loaded"),
    trackedNo: L(" · 没有追踪表导出", " · no tracker export"),
    sMatch: L("符合条件", "Matches"), sNew: L("新出现", "New today"), sTracked: L("已在追踪表", "Tracked"), sRemote: L("远程", "Remote"),
    posted: L("发布 ", "posted "), yrs: L("要求 {n}+ 年", "{n}+ yrs"), resume: L("简历 ", "resume "), fit: L("条件 ", "fit "),
    open: L("打开职位页面 ↗", "Open posting ↗"), link: L("链接", "Link"), rawLoc: L("地点原文", "Location"),
    have: L("对上的技能", "Skills you have"), missReq: L("缺（必须）", "Missing (required)"), missNice: L("缺（加分项）", "Missing (nice to have)"),
    kw: L("简历里没有的词", "Not on your resume"), notes: L("注意", "Notes"),
    emptyFilter: L("这个筛选下没有职位。", "No postings match these filters."), emptyAll: L("这次没有符合条件的职位。", "No matching postings this run."),
  };

  const data = rows.map(r => ({
    company: r.job.company, title: r.job.title, url: /^https?:\/\//.test(r.job.url) ? r.job.url : "",
    location: r.job.location, where: r.where, pay: r.job.pay, posted: r.job.posted,
    score: r.score, resume: r.resumeScore, fit: r.fitScore, label: r.label, years: r.years,
    reqHit: r.required.length - r.missingRequired.length, reqAll: r.required.length,
    matched: r.matched, missingRequired: r.missingRequired, missingNice: r.missingNice,
    keywords: r.keywords, flags: r.flags, isNew: r.isNew,
    tracked: r.tracked ? { status: r.tracked.status, applied: r.tracked.applied } : null,
  }));
  const json = JSON.stringify({ meta, t, rows: data }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Radar ${meta.date}</title>
<style>
:root {
  --bg: #f4f6f8; --surface: #fff; --fg: #17212b; --muted: #5f6c78; --line: #dde3e9;
  --accent: #1d5fd1; --accent-soft: #e4ecfb;
  --strong: #1b7a4b; --strong-soft: #e1f3e9; --good: #1d5fd1; --good-soft: #e4ecfb; --stretch: #9a5b00; --stretch-soft: #fbefd9;
  --bad: #b3261e; --new: #a33fa8; --new-soft: #f6e6f7;
  --sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", "Segoe UI", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) { :root {
  --bg: #0f151b; --surface: #17202a; --fg: #e6edf3; --muted: #93a1ae; --line: #2a3643;
  --accent: #6ea2ff; --accent-soft: #1b2b45;
  --strong: #5fd39a; --strong-soft: #15302a; --good: #6ea2ff; --good-soft: #1b2b45; --stretch: #f0b45a; --stretch-soft: #362a14;
  --bad: #ff8a80; --new: #e39be6; --new-soft: #33203a; color-scheme: dark;
} }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 var(--sans); }
.wrap { max-width: 1040px; margin: 0 auto; padding: 28px 16px 64px; display: flex; flex-direction: column; gap: 18px; }
h1 { margin: 0; font-size: 24px; letter-spacing: -0.01em; }
.sub { color: var(--muted); font-size: 14px; margin-top: 2px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.stats div { background: var(--surface); padding: 12px 14px; }
.stats b { display: block; font: 500 22px var(--mono); font-variant-numeric: tabular-nums; }
.stats span { font-size: 12px; color: var(--muted); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); }
.seg button { border: 0; background: transparent; padding: 6px 12px; font: inherit; font-size: 13px; color: var(--fg); cursor: pointer; }
.seg button + button { border-left: 1px solid var(--line); }
.seg button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
select, input[type="search"] { font: inherit; font-size: 13px; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; }
input[type="search"] { flex: 1 1 180px; min-width: 0; }
label.chk { font-size: 13px; color: var(--muted); display: inline-flex; gap: 5px; align-items: center; }
.list { display: flex; flex-direction: column; gap: 8px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.card summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; align-items: center; padding: 12px 16px; }
.card summary::-webkit-details-marker { display: none; }
.card[open] summary { border-bottom: 1px dashed var(--line); }
.score { text-align: center; border-radius: 8px; padding: 6px 0; }
.score b { display: block; font: 600 22px var(--mono); line-height: 1.1; }
.score span { font-size: 11px; letter-spacing: 0.04em; }
.Strong { background: var(--strong-soft); color: var(--strong); }
.Good { background: var(--good-soft); color: var(--good); }
.Stretch { background: var(--stretch-soft); color: var(--stretch); }
.main { min-width: 0; }
.co { font-weight: 600; }
.ti { overflow-wrap: anywhere; }
.meta { color: var(--muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 2px; }
.sub2 { text-align: right; font: 12px var(--mono); color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.trk { display: inline-block; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 600; border-radius: 4px; padding: 0 6px; margin-left: 6px; vertical-align: 2px; }
.card.is-tracked { opacity: 0.78; }
.new { display: inline-block; background: var(--new-soft); color: var(--new); font-size: 11px; font-weight: 600; border-radius: 4px; padding: 0 6px; margin-left: 6px; vertical-align: 2px; }
.detail { padding: 12px 16px 16px; display: grid; grid-template-columns: 140px 1fr; gap: 6px 14px; font-size: 14px; }
.detail dt { color: var(--muted); font-size: 13px; }
.detail dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.tag { display: inline-block; border-radius: 4px; padding: 0 6px; margin: 0 4px 4px 0; font-size: 13px; background: var(--bg); border: 1px solid var(--line); }
.tag.ok { color: var(--strong); border-color: transparent; background: var(--strong-soft); }
.tag.miss { color: var(--bad); }
.tag.kw { font-family: var(--mono); font-size: 12px; }
.flag { color: var(--stretch); }
a { color: var(--accent); }
.empty { text-align: center; color: var(--muted); padding: 40px; border: 1px dashed var(--line); border-radius: 10px; }
.foot { color: var(--muted); font-size: 12px; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 620px) {
  .card summary { grid-template-columns: 56px 1fr; }
  .sub2 { grid-column: 2; text-align: left; }
  .detail { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Job Radar</h1>
    <div class="sub" id="sub"></div>
  </header>
  <section class="stats" id="stats"></section>
  <div class="controls">
    <div class="seg" id="where" role="group" aria-label="${L("地点", "Location")}">
      <button type="button" data-v="" aria-pressed="true">${L("全部地点", "All locations")}</button><button type="button" data-v="Remote US" aria-pressed="false">${L("远程", "Remote")}</button><button type="button" data-v="${esc(meta.localLabel)}" aria-pressed="false">${esc(meta.localLabel)}</button>
    </div>
    <div class="seg" id="label" role="group" aria-label="${L("匹配度", "Match")}">
      <button type="button" data-v="" aria-pressed="true">${L("全部", "All")}</button><button type="button" data-v="Strong" aria-pressed="false">Strong</button><button type="button" data-v="Good" aria-pressed="false">Good</button><button type="button" data-v="Stretch" aria-pressed="false">Stretch</button>
    </div>
    <select id="sort" aria-label="${L("排序", "Sort")}">
      <option value="score">${L("按总分", "Total score")}</option><option value="resume">${L("按简历分", "Resume score")}</option><option value="fit">${L("按条件分", "Fit score")}</option><option value="posted">${L("按发布日期", "Newest")}</option>
    </select>
    <label class="chk"><input type="checkbox" id="onlyNew"> ${L("只看新的", "New only")}</label>
    <label class="chk"><input type="checkbox" id="hideTracked"> ${L("隐藏已追踪", "Hide tracked")}</label>
    <input type="search" id="q" placeholder="${L("搜公司、职位、技能", "Search company, role, skill")}" aria-label="${L("搜索", "Search")}">
  </div>
  <div class="list" id="list"></div>
  <p class="foot">${L(`总分 = 60% 简历分 + 40% 条件分。简历分看你的简历覆盖了多少职位要求的技能（必须项 75 + 加分项 25）；条件分看${fit}。规则打分，只用来排序，投之前请自己读职位描述。点一行展开详情。`, `Total = 60% resume score + 40% fit score. Resume score: how much of the posting's skills your resume covers (required 75 + nice-to-have 25). Fit score: ${fit}. Keyword rules for ranking only; read the posting before applying. Click a row for details.`)}</p>
</div>
<script id="data" type="application/json">${json}</script>
<script>
const { meta, t, rows } = JSON.parse(document.getElementById("data").textContent);
const state = { where: "", label: "", sort: "score", onlyNew: false, hideTracked: false, q: "" };
const STATUS = t.status;
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

$("sub").textContent = meta.date + " · " + meta.companies + t.companies + t.fetched + meta.fetched + t.postings + (meta.errors.length ? " · " + meta.errors.length + t.failed : "") + (meta.trackedFile ? t.trackedYes : t.trackedNo);
const stat = (n, l) => { const d = el("div"); d.append(el("b", null, String(n)), el("span", null, l)); return d; };
$("stats").append(
  stat(rows.length, t.sMatch), stat(rows.filter(r => r.isNew).length, t.sNew),
  stat(rows.filter(r => r.tracked).length, t.sTracked),
  stat(rows.filter(r => r.label === "Strong").length, "Strong"), stat(rows.filter(r => r.where === "Remote US").length, t.sRemote),
  stat(rows.filter(r => r.where === meta.localLabel).length, meta.localLabel));

function tags(list, cls) { const f = document.createDocumentFragment(); list.forEach(t => f.append(el("span", "tag " + cls, t))); return f; }
function row(dl, k, v) { if (!v || (v.childNodes && !v.childNodes.length)) return; dl.append(el("dt", null, k)); const dd = el("dd"); dd.append(v); dl.append(dd); }

function card(r) {
  const d = el("details", "card" + (r.tracked ? " is-tracked" : ""));
  const s = el("summary");
  const sc = el("div", "score " + r.label); sc.append(el("b", null, String(r.score)), el("span", null, r.label));
  const main = el("div", "main");
  const co = el("div", "co", r.company); if (r.isNew) co.append(el("span", "new", "NEW"));
  if (r.tracked) co.append(el("span", "trk", (STATUS[r.tracked.status] || r.tracked.status) + (r.tracked.applied ? " " + r.tracked.applied.slice(5).replace("-", "/") : "")));
  const meta = el("div", "meta");
  [r.where, r.pay, r.posted && (t.posted + r.posted), r.years != null && t.yrs.replace("{n}", r.years)].filter(Boolean).forEach(t => meta.append(el("span", null, t)));
  main.append(co, el("div", "ti", r.title), meta);
  const sub = el("div", "sub2"); sub.append(el("div", null, t.resume + r.resume + " (" + r.reqHit + "/" + r.reqAll + ")"), el("div", null, t.fit + r.fit));
  s.append(sc, main, sub);
  const dl = el("dl", "detail");
  if (r.url) { const a = el("a", null, t.open); a.href = r.url; a.target = "_blank"; a.rel = "noopener"; row(dl, t.link, a); }
  row(dl, t.rawLoc, r.location ? document.createTextNode(r.location) : null);
  row(dl, t.have, tags(r.matched, "ok"));
  row(dl, t.missReq, tags(r.missingRequired, "miss"));
  row(dl, t.missNice, tags(r.missingNice, ""));
  row(dl, t.kw, tags(r.keywords, "kw"));
  if (r.flags.length) { const f = el("div"); r.flags.forEach(t => f.append(el("div", "flag", "! " + t))); row(dl, t.notes, f); }
  d.append(s, dl);
  return d;
}

function render() {
  const q = state.q.trim().toLowerCase();
  let list = rows.filter(r =>
    (!state.where || r.where === state.where) && (!state.label || r.label === state.label) && (!state.onlyNew || r.isNew) && (!state.hideTracked || !r.tracked) &&
    (!q || [r.company, r.title, r.location, ...r.matched, ...r.missingRequired, ...r.keywords].join(" ").toLowerCase().includes(q)));
  const key = state.sort;
  list = list.slice().sort((a, b) => key === "posted" ? String(b.posted).localeCompare(String(a.posted)) : b[key] - a[key] || b.score - a.score);
  const box = $("list"); box.replaceChildren();
  if (!list.length) { box.append(el("div", "empty", rows.length ? t.emptyFilter : t.emptyAll)); return; }
  list.forEach(r => box.append(card(r)));
}

for (const id of ["where", "label"]) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state[id] = b.dataset.v;
    $(id).querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
}
$("sort").addEventListener("change", e => { state.sort = e.target.value; render(); });
$("onlyNew").addEventListener("change", e => { state.onlyNew = e.target.checked; render(); });
$("hideTracked").addEventListener("change", e => { state.hideTracked = e.target.checked; render(); });
$("q").addEventListener("input", e => { state.q = e.target.value; render(); });
render();
</script>
</body>
</html>
`;
}
