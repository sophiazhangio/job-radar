#!/usr/bin/env node
// npm run bank -- <resume.pdf|.txt|.md>: draft a bullet bank (resume.local.json) for npm run tailor
// from the resume you already have. No AI: it reads the layout (headings, indents, bullet
// marks, dates) and copies your own text into the bank format. Check the result, then add
// the bullets that didn't fit on your resume.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Bank, Entry, Section } from "./tailor.ts";

// ---- Lines with their position on the page ----

export type Line = { text: string; x: number; end: number; size: number; lead: string };
// text: the line, with a tab where there is a wide gap (left and right columns).
// x / end: where the line starts and ends. size: font size. lead: leading text in a different font (often bold).

export async function pdfLines(path: string): Promise<Line[]> {
  const warn = console.warn, log = console.log;
  console.warn = console.log = () => {}; // pdf.js prints a harmless "use legacy build" warning
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
    type Part = { x: number; w: number; s: string; font: string; h: number };
    const rows: { parts: Part[] }[] = [];
    const fontChars = new Map<string, number>();
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const { items } = await page.getTextContent();
      const pageRows: { y: number; parts: Part[] }[] = [];
      for (const it of items as any[]) {
        if (!it.str || !it.str.trim()) continue;
        const y = it.transform[5];
        let r = pageRows.find(r => Math.abs(r.y - y) <= 2);
        if (!r) pageRows.push(r = { y, parts: [] });
        r.parts.push({ x: it.transform[4], w: it.width, s: it.str, font: it.fontName, h: Math.abs(it.transform[3]) || it.height });
        fontChars.set(it.fontName, (fontChars.get(it.fontName) ?? 0) + it.str.length);
      }
      pageRows.sort((a, b) => b.y - a.y);
      rows.push(...pageRows);
    }
    const body = [...fontChars].sort((a, b) => b[1] - a[1])[0]?.[0];
    return rows.map(({ parts }) => {
      parts.sort((a, b) => a.x - b.x);
      let text = "", lead = "", inLead = parts[0].font !== body;
      parts.forEach((p, i) => {
        const prev = parts[i - 1];
        const gap = prev ? p.x - (prev.x + prev.w) : 0;
        const sep = !prev ? "" : gap > 12 ? "\t" : gap > 1 && !/\s$/.test(prev.s) && !/^\s/.test(p.s) ? " " : "";
        text += sep + p.s;
        if (inLead && p.font === body) inLead = false;
        if (inLead) lead += sep + p.s;
      });
      const last = parts[parts.length - 1];
      return {
        text: text.replace(/ {2,}/g, " ").trim(), x: parts[0].x, end: last.x + last.w,
        size: Math.max(...parts.map(p => p.h)), lead: lead.trim(),
      };
    }).filter(l => l.text);
  } finally { console.warn = warn; console.log = log; }
}

export function textLines(text: string): Line[] {
  return text.split(/\r?\n/).filter(t => t.trim()).map(raw => {
    const md = raw.match(/^\s*(#{1,6})\s/);
    const bold = raw.match(/^\s*\*\*(.+?)\*\*/);
    const t = raw.replace(/\*\*/g, "").replace(/ {3,}/g, "\t").trim();
    return { text: t.replace(/^#+\s*/, ""), x: raw.search(/\S/), end: 0, size: md ? 7 - md[1].length : 0, lead: bold?.[1] ?? "" };
  });
}

// ---- Reading the layout ----

const HEADINGS = [
  "summary", "professional summary", "profile", "about", "about me", "objective",
  "experience", "work experience", "professional experience", "relevant experience", "employment", "work history",
  "projects", "personal projects", "selected projects", "academic projects", "technical projects",
  "education", "skills", "technical skills", "skills and tools", "skills & tools", "core skills",
  "leadership", "leadership experience", "activities", "leadership & activities", "involvement",
  "awards", "honors", "honors & awards", "certifications", "certificates", "publications", "research",
  "research experience", "volunteer", "volunteering", "volunteer experience", "coursework", "relevant coursework",
  "languages", "interests", "additional information", "other",
];
const SQUASH = new Map(HEADINGS.map(h => [h.replace(/[^a-z]/g, ""), h]));

// caps: also accept an unknown ALL-CAPS line (off for the name line at the top).
export function headingOf(l: Line, caps = true): string | null {
  const t = l.text.replace(/[:：]\s*$/, "").trim();
  if (t.includes("\t") || /\d/.test(t) || t.length > 40) return null;
  const known = SQUASH.get(t.toLowerCase().replace(/[^a-z]/g, ""));
  caps &&= /^[A-Z][A-Z &/]+$/.test(t) && t.replace(/[^A-Z]/g, "").length >= 4 && t.split(/\s+/).length <= 4;
  if (!known && !caps) return null;
  const name = known ?? t.replace(/\s+/g, " ").toLowerCase();
  return name.replace(/\b\w/g, c => c.toUpperCase()).replace(/\bAnd\b/, "and");
}

const MON = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const POINT = `(?:${MON}\\s+\\d{4}|\\d{1,2}/\\d{4}|(?:19|20)\\d{2})`;
const DATE = new RegExp(`(?:${POINT}\\s*(?:[–—-]|to)\\s*(?:${POINT}|present|current|now|ongoing)|(?:expected\\s+)?${MON}\\s+\\d{4}|(?:expected\\s+)?(?:19|20)\\d{2}(?!\\d))`, "i");
const GLYPH = /^\s*[•●▪◦‣∙■□➢►▸✓–*-]\s*/;
const CONTACT = /@|https?:|www\.|\b[\w-]+\.(?:com|io|dev|me|org|net|app|ai|co)\b|linkedin|github|portfolio|\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}|^[A-Z][a-zA-Z .]+, [A-Z]{2}$/i;

function joinText(a: string, b: string): string {
  if (!a) return b;
  return /[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) ? a + b : `${a} ${b}`;
}

// "Title<tab>May 2024 – Present" → title + date; columns without a date put the right side in date.
function splitTitle(text: string): { title: string; date?: string; rest: string[] } {
  const cols = text.split("\t").map(s => s.trim()).filter(Boolean);
  let date: string | undefined;
  const at = cols.findIndex((c, i) => i > 0 && DATE.test(c));
  if (at > 0) date = cols.splice(at, 1)[0];
  else if (cols.length === 1) {
    const m = cols[0].match(new RegExp(`\\s*[|,·–—-]?\\s*(${DATE.source})\\s*$`, "i"));
    if (m && m.index! > 0) { date = m[1]; cols[0] = cols[0].slice(0, m.index).trim(); }
  } else if (cols.length > 1) date = cols.pop();
  return { title: cols[0] ?? "", date, rest: cols.slice(1) };
}

function splitOrg(text: string): { org: string; place?: string } {
  const cols = text.split("\t").map(s => s.trim()).filter(Boolean);
  if (cols.length > 1) return { org: cols[0], place: cols.slice(1).join(" · ") };
  const m = text.match(/^(.*\S)\s+(?:[|·–—-]\s+)?((?:[A-Z][a-zA-Z.]+ ?)+, [A-Z]{2}|Remote)$/);
  return m ? { org: m[1].replace(/[,|·–—-]\s*$/, "").trim(), place: m[2] } : { org: text };
}

function splitItems(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";" || ch === "·" || ch === "|") && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function draftBank(lines: Line[]): Bank {
  const fromPdf = lines.some(l => l.end > 0);
  const ends = lines.map(l => l.end).sort((a, b) => a - b);
  const right = ends[Math.floor(ends.length * 0.9)] ?? 0; // the text's right margin
  const left = Math.min(...lines.map(l => l.x));
  // A line that stops far short of the right margin ends its paragraph.
  const ranHalf = (l: Line) => fromPdf && l.end < right - (right - left) * 0.25;
  const bank: Bank = { name: "", sections: [] };
  const titles: string[] = [], contact: { text: string; url?: string }[][] = [], summary: string[] = [];

  // Split into the header block and the sections. Big text at the top is the name, not a heading.
  const sizes = lines.map(l => l.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)];
  const capsOk = (l: Line, i: number) => i > 0 && (!fromPdf || l.size <= body + 1.5);
  const first = lines.findIndex((l, i) => headingOf(l, capsOk(l, i)));
  const head = first < 0 ? lines : lines.slice(0, first);
  const groups: { heading: string; lines: Line[] }[] = [];
  for (const [i, l] of (first < 0 ? [] : lines.slice(first)).entries()) {
    const h = headingOf(l, capsOk(l, first + i));
    if (h) groups.push({ heading: h, lines: [] });
    else groups[groups.length - 1].lines.push(l);
  }

  // Header: the biggest (or first) line is the name; contact bits, a short headline, and any summary sentences.
  const nameAt = fromPdf ? head.reduce((b, l, i) => (l.size > head[b].size ? i : b), 0) : 0;
  bank.name = (head[nameAt]?.text ?? "Your Name").replace(/\t.*/, "");
  let para = "";
  head.forEach((l, i) => {
    if (i === nameAt) return;
    const bits: { text: string; url?: string }[] = [];
    // Separators like | • · only split contact lines; elsewhere "·" can be part of a sentence.
    const pieces = l.text.split("\t").flatMap(c => (CONTACT.test(c) ? c.split(/\s*[|•·]\s*/) : [c])).map(s => s.trim()).filter(Boolean);
    for (const piece of pieces) {
      if (CONTACT.test(piece) && piece.split(/\s+/).length <= 5) bits.push(link(piece));
      else if (piece.split(/\s+/).length <= 6 && !/[.!]$/.test(piece) && !para) titles.push(piece);
      else para = joinText(para, piece);
    }
    if (bits.length) contact.push(bits);
    if (para && (ranHalf(l) || i === head.length - 1)) { summary.push(para); para = ""; }
  });
  if (para) summary.push(para);

  for (const g of groups) {
    const kind = /skill|languages|technolog|tools|coursework|interests|certif/i.test(g.heading) ? "list"
      : /summary|profile|objective|about/i.test(g.heading) ? "summary" : "entries";
    if (kind === "summary") { summary.push(g.lines.map(l => l.text.replace(/\t/g, " ")).reduce(joinText, "")); continue; }
    if (kind === "list") { bank.sections.push(listSection(g.heading, g.lines)); continue; }
    bank.sections.push(entrySection(g.heading, g.lines, ranHalf, fromPdf ? 4 : 0));
  }

  if (titles.length) bank.title = titles;
  if (contact.length) bank.contact = contact;
  if (summary.length) bank.summary = summary.filter(Boolean).map(text => ({ text }));
  return bank;
}

function link(text: string): { text: string; url?: string } {
  if (/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(text)) return { text, url: `mailto:${text}` };
  if (/^(https?:\/\/)?(www\.)?[\w-]+\.[a-z]{2,}(\/\S*)?$/i.test(text)) return { text: text.replace(/^https?:\/\//, ""), url: /^https?:/.test(text) ? text : `https://${text}` };
  return { text };
}

function listSection(heading: string, lines: Line[]): Section {
  const skills: { label: string; items: string[] }[] = [];
  for (const l of lines) {
    const t = l.text.replace(GLYPH, "").trim();
    const colon = t.match(/^([^:：,]{2,30})[:：]\s*(.+)$/);
    const tab = t.match(/^([^\t,]{2,30})\t(.+)$/);
    const lead = l.lead && t.startsWith(l.lead) && !l.lead.includes(",") ? l.lead.replace(/[:：]$/, "") : "";
    const label = colon?.[1] ?? tab?.[1] ?? lead;
    const rest = colon?.[2] ?? tab?.[2] ?? (lead ? t.slice(l.lead.length) : t);
    const items = splitItems(rest.replace(/^[:：]\s*/, "").replace(/\t/g, ", "));
    if (label) skills.push({ label: label.trim(), items });
    else if (skills.length) skills[skills.length - 1].items.push(...items);
    else skills.push({ label: heading, items });
  }
  // A wrapped line can split an item in two ("real-" / "time"); glue those back.
  for (const s of skills) s.items = s.items.reduce<string[]>((a, it) => {
    if (a.length && /[A-Za-z]-$/.test(a[a.length - 1]) && /^[a-z]/.test(it)) a[a.length - 1] += it; else a.push(it);
    return a;
  }, []);
  return { heading, skills };
}

function entrySection(heading: string, lines: Line[], ranHalf: (l: Line) => boolean, indent: number): Section {
  const left = Math.min(...lines.map(l => l.x));
  const entries: (Entry & { _intro: string[]; _b: string[] })[] = [];
  let cur: (typeof entries)[number] | undefined;
  let mode: "head" | "bullets" = "head";
  let prev: Line | undefined;
  const isEducation = /education/i.test(heading);

  for (const l of lines) {
    const glyph = GLYPH.test(l.text);
    const text = l.text.replace(GLYPH, "").trim();
    const indented = l.x > left + indent;
    const bullet = glyph || (indented && !!cur);
    if (bullet && cur) {
      const prevText = cur._b[cur._b.length - 1] ?? "";
    const fresh = glyph || mode !== "bullets" || !prev || ranHalf(prev)
      || (/[.!?]["”)]?$/.test(prevText) && /^[A-Z0-9]/.test(text)) || (!l.end && !/^[a-z(]/.test(text));
      if (fresh) cur._b.push(text.replace(/\t/g, " "));
      else cur._b[cur._b.length - 1] = joinText(cur._b[cur._b.length - 1], text.replace(/\t/g, " "));
      mode = "bullets"; prev = l; continue;
    }
    // A line at the left margin: a new entry, the org line under a title, or an intro sentence.
    const boldStart = l.lead.replace(/[^A-Za-z]/g, "").length >= 3 && l.lead.length >= l.text.length * 0.4 && l.text.startsWith(l.lead);
    const titleish = DATE.test(l.text) || l.text.includes("\t") || boldStart;
    const newEntry = !cur || mode === "bullets" || (titleish && !!cur.org) || (titleish && !!cur.date && DATE.test(l.text) && !l.text.includes("\t") && cur.title !== "" && !!cur.org)
      || (!!cur && cur._intro.length > 0 && titleish);
    if (newEntry && (titleish || !cur || mode === "bullets")) {
      const t = splitTitle(text);
      t.title = t.title.replace(/\s+(?:github|gitlab|live demo|demo|website|site|link|repo|code|app store|play store)$/i, "");
      cur = { title: t.title, ...(t.date ? { date: t.date } : {}), _intro: [], _b: [] };
      if (t.rest.length) cur.org = t.rest.join(" · ");
      entries.push(cur); mode = "head";
    } else if (cur && !cur.org && cur._intro.length === 0 && (l.text.includes("\t") || text.split(/\s+/).length <= 10 && !/[.!]$/.test(text))) {
      let rest = text;
      if (DATE.test(text)) { const t = splitTitle(text); if (t.date && !cur.date) cur.date = t.date; rest = [t.title, ...t.rest].join("\t"); }
      const o = splitOrg(rest);
      cur.org = o.org; if (o.place) cur.place = o.place;
    } else if (cur) {
      const intro = cur._intro;
      if (intro.length && prev && !ranHalf(prev) && prev.x <= left + indent) intro[intro.length - 1] = joinText(intro[intro.length - 1], text.replace(/\t/g, " "));
      else intro.push(text.replace(/\t/g, " "));
    }
    prev = l;
  }

  return {
    heading,
    entries: entries.map(({ _intro, _b, ...e }) => {
      let bullets = _b;
      // No bullet marks or indents: the sentences under the title are the bullets.
      if (!bullets.length && _intro.length && !isEducation) { bullets = _intro; _intro = []; }
      const out: Entry = { ...e };
      if (_intro.length) out.intro = _intro.join(" ");
      if (bullets.length) out.bullets = bullets.map(text => (isEducation ? { text, pin: true } : { text, tags: [] }));
      return out;
    }),
  };
}

// ---- Command ----

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
  let src = args.find((a, i) => !a.startsWith("--") && !["--out"].includes(args[i - 1]));
  if (!src) {
    const cfg = resolve(ROOT, "config.local.json");
    if (existsSync(cfg)) { try { src = JSON.parse(readFileSync(cfg, "utf8")).resume; } catch { /* fall through */ } }
  }
  if (!src) { console.error("Usage: npm run bank -- <resume.pdf | .txt | .md> [--out resume.local.json] [--force]"); process.exit(1); }
  const path = resolve(ROOT, src.replace(/^['"]|['"]$/g, ""));
  if (!existsSync(path)) { console.error(`Resume not found: ${path}`); process.exit(1); }
  const out = resolve(ROOT, opt("out") ?? "resume.local.json");
  if (existsSync(out) && !args.includes("--force")) {
    console.error(`${basename(out)} already exists. Add --force to replace it, or --out other.json to write somewhere else.`);
    process.exit(1);
  }

  const lines = path.toLowerCase().endsWith(".pdf") ? await pdfLines(path) : textLines(await readFile(path, "utf8"));
  const bank = draftBank(lines);
  const note = `Drafted by npm run bank from ${basename(path)}. Check every line against your resume. Then add bullets that didn't fit on it (more than a page is the point), alternate wordings ("alt"), skill "tags" a bullet shows without naming, and "pin": true for bullets that must always appear. See resume.example.json.`;
  await writeFile(out, JSON.stringify({ _note: note, ...bank }, null, 2) + "\n");

  console.log(`Wrote ${out}\n`);
  console.log(`  name     ${bank.name}`);
  if (bank.contact) console.log(`  contact  ${bank.contact.flat().map(c => c.text).join(" | ")}`);
  for (const s of bank.sections) {
    const n = s.entries?.length ?? 0, b = s.entries?.reduce((a, e) => a + (e.bullets?.length ?? 0), 0) ?? 0;
    console.log(`  ${s.heading.padEnd(9)} ${s.skills ? `${s.skills.length} skill line(s)` : `${n} entr${n === 1 ? "y" : "ies"}, ${b} bullet(s)`}`);
    for (const e of s.entries ?? []) console.log(`             - ${e.title}${e.date ? ` (${e.date})` : ""}`);
  }
  console.log(`\nThis is a draft read from your resume's layout. Open ${basename(out)} and check it, then add more bullets.\nNext: npm run tailor -- <posting URL>`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
