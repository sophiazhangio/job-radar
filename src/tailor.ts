// tailor: build a one-page resume for one posting from a bank of your own bullets.
//
// The bank (a JSON file you keep out of git) lists everything you could put on a resume,
// with alternate wordings. tailor scores each bullet against the posting's skills, keeps the
// best ones, renders HTML and a PDF, and drops the weakest bullets until the PDF is one page.
// It only picks and orders your own text; it never writes new claims.

import { writeFile, mkdir, readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CORE, findSkills } from "./skills.ts";

// ---- Bank format ----

export type Bullet = string | { text: string; alt?: string[]; tags?: string[]; pin?: boolean };
export type Entry = {
  title: string;
  link?: { text: string; url: string }; // shown after the title, e.g. a live demo
  org?: string;
  date?: string; // right side of the title row
  place?: string; // right side of the org row
  intro?: string;
  tags?: string[];
  always?: boolean; // in a section with "pick", always include this entry
  min?: number; // fewest bullets to keep (default 1)
  max?: number; // most bullets to keep (default: all)
  bullets?: Bullet[];
};
export type Section = {
  heading: string;
  pick?: number; // choose this many entries by score (default: all)
  entries?: Entry[];
  skills?: { label: string; items: string[] }[];
};
export type Bank = {
  name: string;
  title?: string | string[]; // headline under the name; the closest to the posting title wins
  contact?: { text: string; url?: string }[][]; // lines of contact items
  summary?: string | { text: string; tags?: string[] }[];
  sections: Section[];
  accent?: string; // CSS colour for headings
};

// ---- What the posting asks for ----

export type Want = { required: string[]; nice: string[]; keywords: string[]; title: string };

type Scored = { text: string; score: number; pin: boolean; order: number };

const lower = (s: string) => s.toLowerCase();
const plain = (s: string) => s.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

// Points for a piece of text: required skills 3 (core 6), nice-to-have 1 (core 2), posting keywords 1 each (up to 3).
export function textScore(text: string, tags: string[] = [], want: Want): number {
  const t = lower(plain(text) + " " + tags.join(" "));
  const found = findSkills(t);
  let s = 0;
  for (const k of want.required) if (found.has(k)) s += CORE.has(k) ? 6 : 3;
  for (const k of want.nice) if (found.has(k)) s += CORE.has(k) ? 2 : 1;
  s += Math.min(3, want.keywords.filter(w => t.includes(lower(w))).length);
  return s;
}

function bestVariant(b: Bullet, want: Want): { text: string; score: number; pin: boolean } {
  if (typeof b === "string") return { text: b, score: textScore(b, [], want), pin: false };
  let best = { text: b.text, score: textScore(b.text, b.tags, want) };
  for (const a of b.alt ?? []) {
    const s = textScore(a, b.tags, want);
    if (s > best.score) best = { text: a, score: s };
  }
  return { ...best, pin: !!b.pin };
}

// Pick the headline closest to the posting title (shared words, fewer extra words).
export function pickTitle(title: Bank["title"], postingTitle: string): string {
  const list = !title ? [] : Array.isArray(title) ? title : [title];
  if (list.length <= 1) return list[0] ?? "";
  // "Full Stack", "full-stack" and "Fullstack" are the same word
  const words = (s: string) => lower(s).replace(/\b(full|front|back)[\s-]+(stack|end)\b/g, "$1$2").split(/[^a-z0-9+#]+/).filter(Boolean);
  const want = new Set(words(postingTitle));
  const score = (s: string) => { const w = words(s); const hit = w.filter(x => want.has(x)).length; return hit - 0.1 * (w.length - hit); };
  return list.reduce((a, b) => (score(b) > score(a) ? b : a));
}

export type Chosen = {
  name: string;
  title: string;
  contact: Bank["contact"];
  summary: string;
  accent?: string;
  sections: { heading: string; entries: { entry: Entry; bullets: Scored[]; score: number }[]; skills?: { label: string; items: string[] }[] }[];
};

// Choose content for a posting. Pure: no files, no browser.
export function choose(bank: Bank, want: Want): Chosen {
  const summaries = !bank.summary ? [] : typeof bank.summary === "string" ? [{ text: bank.summary }] : bank.summary;
  const summary = summaries.reduce<{ text: string; s: number } | null>((best, x) => {
    const s = textScore(x.text, x.tags, want);
    return !best || s > best.s ? { text: x.text, s } : best;
  }, null)?.text ?? "";

  const wanted = new Set([...want.required, ...want.nice]);
  const sections = bank.sections.map(sec => {
    if (sec.skills) {
      // matched skills move to the front of each line; lines keep their order
      const skills = sec.skills.map(line => {
        const hit = (item: string) => [...findSkills(item)].some(k => wanted.has(k));
        return { label: line.label, items: [...line.items.filter(hit), ...line.items.filter(i => !hit(i))] };
      });
      return { heading: sec.heading, entries: [], skills };
    }
    let entries = (sec.entries ?? []).map(entry => {
      const all = (entry.bullets ?? []).map((b, order) => ({ ...bestVariant(b, want), order }));
      const max = entry.max ?? all.length;
      const pinned = all.filter(b => b.pin);
      const rest = all.filter(b => !b.pin).sort((a, b) => b.score - a.score || a.order - b.order);
      const kept = [...pinned, ...rest.slice(0, Math.max(0, max - pinned.length))];
      // strongest first; pinned bullets keep their place at the top
      kept.sort((a, b) => Number(b.pin) - Number(a.pin) || b.score - a.score || a.order - b.order);
      const score = textScore([entry.title, entry.intro ?? ""].join(" "), entry.tags, want) + kept.reduce((s, b) => s + b.score, 0);
      return { entry, bullets: kept, score };
    });
    if (sec.pick !== undefined) {
      const always = entries.filter(e => e.entry.always);
      const others = entries.filter(e => !e.entry.always).sort((a, b) => b.score - a.score);
      const keep = new Set([...always, ...others.slice(0, Math.max(0, sec.pick - always.length))]);
      entries = entries.filter(e => keep.has(e)).sort((a, b) => Number(!!b.entry.always) - Number(!!a.entry.always) || b.score - a.score);
    }
    return { heading: sec.heading, entries };
  });
  return { name: bank.name, title: pickTitle(bank.title, want.title), contact: bank.contact, summary, accent: bank.accent, sections };
}

// Remove the weakest bullet that can go (respecting min), or the weakest picked entry. Returns what was removed.
export function dropOne(c: Chosen, bank: Bank): string | null {
  let worst: { sec: number; ent: number; b: number; score: number } | null = null;
  c.sections.forEach((sec, si) => sec.entries.forEach((e, ei) => {
    if (e.bullets.length <= (e.entry.min ?? 1)) return;
    e.bullets.forEach((b, bi) => {
      if (b.pin) return;
      if (!worst || b.score < worst.score || (b.score === worst.score && b.order > (c.sections[worst.sec].entries[worst.ent].bullets[worst.b].order))) worst = { sec: si, ent: ei, b: bi, score: b.score };
    });
  }));
  if (worst) {
    const w = worst as { sec: number; ent: number; b: number };
    const [gone] = c.sections[w.sec].entries[w.ent].bullets.splice(w.b, 1);
    return plain(gone.text);
  }
  // no bullet can go: drop the weakest optional entry in a section that picks entries
  let we: { sec: number; ent: number; score: number } | null = null;
  c.sections.forEach((sec, si) => {
    if (bank.sections[si]?.pick === undefined) return;
    sec.entries.forEach((e, ei) => { if (!e.entry.always && (!we || e.score < we.score)) we = { sec: si, ent: ei, score: e.score }; });
  });
  if (we) {
    const w = we as { sec: number; ent: number };
    const [gone] = c.sections[w.sec].entries.splice(w.ent, 1);
    return gone.entry.title;
  }
  return null;
}

// ---- Rendering ----

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// **bold** and [text](url) only.
export function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b class="lead">$1</b>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
}

export function toText(c: Chosen): string {
  const out = [c.name, c.title, c.summary];
  for (const s of c.sections) {
    out.push(s.heading);
    for (const e of s.entries) out.push(e.entry.title, e.entry.org ?? "", e.entry.intro ?? "", ...e.bullets.map(b => b.text));
    for (const l of s.skills ?? []) out.push(`${l.label}: ${l.items.join(", ")}`);
  }
  return plain(out.filter(Boolean).join("\n"));
}

export function toResumeHtml(c: Chosen): string {
  const contact = (c.contact ?? []).map(line => `<div>${line.map(i => i.url ? `<a href="${esc(i.url)}">${esc(i.text)}</a>` : esc(i.text)).join('<span class="sep">|</span>')}</div>`).join("\n    ");
  const entry = (e: Chosen["sections"][number]["entries"][number]) => {
    const x = e.entry;
    const link = x.link ? ` &nbsp;<a class="ext" href="${esc(x.link.url)}">${esc(x.link.text)}</a>` : "";
    const rows = [`<div class="row"><span class="role">${inline(x.title)}${link}</span><span class="meta">${inline(x.date ?? "")}</span></div>`];
    if (x.org || x.place) rows.push(`<div class="row sub"><span>${inline(x.org ?? "")}</span><span>${inline(x.place ?? "")}</span></div>`);
    if (x.intro) rows.push(`<div class="intro">${inline(x.intro)}</div>`);
    if (e.bullets.length) rows.push(`<ul>\n${e.bullets.map(b => `  <li>${inline(b.text)}</li>`).join("\n")}\n</ul>`);
    return `<div class="entry">\n${rows.join("\n")}\n</div>`;
  };
  const sections = c.sections.filter(s => s.entries.length || s.skills?.length).map(s => {
    const body = s.skills
      ? `<div class="skills">\n${s.skills.map(l => `  <div><b>${esc(l.label)}</b><span>${inline(l.items.join(", "))}</span></div>`).join("\n")}\n</div>`
      : s.entries.map(entry).join("\n");
    return `<h2>${esc(s.heading)}</h2>\n${body}`;
  }).join("\n\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(c.name)} – Resume</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: Letter; margin: 0.48in 0.58in; }
  * { box-sizing: border-box; }
  :root { --ink: #16181d; --muted: #555b66; --accent: ${c.accent ?? "#1f3a5f"}; --rule: #c9ced6; }
  body { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; font-size: 9.3pt; line-height: 1.38; color: var(--ink); margin: 0; background: #fff; }
  a { color: inherit; text-decoration: none; }
  a.ext { color: var(--accent); font-weight: 500; }
  b { font-weight: 600; }
  header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 7px; border-bottom: 2px solid var(--accent); }
  h1 { font-size: 19pt; font-weight: 700; margin: 0; letter-spacing: -0.3px; line-height: 1.1; }
  .title { margin-top: 3px; font-size: 10pt; font-weight: 500; color: var(--accent); }
  .contact { text-align: right; color: var(--muted); font-size: 8.8pt; line-height: 1.45; }
  .contact .sep { color: #aab; margin: 0 5px; }
  .summary { margin: 7px 0 0; }
  h2 { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.3px; color: var(--accent); border-bottom: 1px solid var(--rule); padding-bottom: 2px; margin: 11px 0 5px; }
  .entry + .entry { margin-top: 6px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .row > span:last-child { text-align: right; white-space: nowrap; }
  .role { font-weight: 600; font-size: 10pt; }
  .meta { color: var(--muted); font-size: 8.9pt; }
  .sub { color: var(--muted); }
  .intro { margin: 3px 0 2px; }
  ul { margin: 1px 0 4px; padding-left: 14px; }
  li { margin: 2px 0; }
  li::marker { color: var(--accent); }
  .skills div { margin: 2px 0; display: grid; grid-template-columns: 108px 1fr; }
</style>
</head>
<body>
<header>
  <div>
    <h1>${esc(c.name)}</h1>
    ${c.title ? `<div class="title">${esc(c.title)}</div>` : ""}
  </div>
  <div class="contact">
    ${contact}
  </div>
</header>
${c.summary ? `<p class="summary">${inline(c.summary)}</p>` : ""}

${sections}
</body>
</html>
`;
}

// ---- PDF ----

export function findChrome(configured?: string): string | null {
  const list = [
    configured, process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean) as string[];
  for (const p of list) if (existsSync(p)) return p;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    const r = spawnSync("which", [name], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

export async function htmlToPdf(chrome: string, htmlFile: string, pdfFile: string): Promise<number> {
  const profile = await mkdtemp(join(tmpdir(), "job-radar-chrome-"));
  try {
    await new Promise<void>((done, fail) => {
      const p = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--use-mock-keychain", "--password-store=basic",
        "--no-pdf-header-footer", "--virtual-time-budget=5000", `--user-data-dir=${profile}`, `--print-to-pdf=${pdfFile}`, `file://${resolve(htmlFile)}`], { stdio: "ignore" });
      const t = setTimeout(() => { p.kill(); fail(new Error("Chrome took longer than 90 s to print the PDF.")); }, 90_000);
      p.on("exit", () => { clearTimeout(t); done(); });
      p.on("error", e => { clearTimeout(t); fail(e); });
    });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
  return countPages(await readFile(pdfFile));
}

export const countPages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

export const slug = (s: string) => lower(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export async function loadBank(path: string): Promise<Bank> {
  const bank = JSON.parse(await readFile(path, "utf8")) as Bank;
  if (!bank.name || !Array.isArray(bank.sections)) throw new Error(`${path} needs "name" and "sections". See resume.example.json.`);
  return bank;
}

export async function writeOut(dir: string, files: Record<string, string>) {
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
}
