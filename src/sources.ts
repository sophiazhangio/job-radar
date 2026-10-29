// Fetch jobs from public ATS job-board APIs (no login, no scraping of HTML pages).

export type Job = {
  id: string;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  posted: string; // YYYY-MM-DD or ""
  pay: string;
  text: string; // plain-text description
};

const UA = { "user-agent": "job-radar (personal job search tool)" };

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
export function decode(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}
export function htmlToText(html: string): string {
  return decode(decode(html)) // Greenhouse double-escapes its HTML
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h\d|br|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
const day = (d: string | number | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function payFromText(text: string): string {
  const m = text.match(/\$\s?\d{2,3}(?:,\d{3}|\.\d+)?\s?[kK]?(?:\s?(?:USD)?\s?(?:-|–|—|to)\s?\$?\s?\d{2,3}(?:,\d{3}|\.\d+)?\s?[kK]?)/);
  return m ? m[0].replace(/\s+/g, " ") : "";
}

async function greenhouse(company: string, token: string): Promise<Job[]> {
  const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`);
  return (d.jobs ?? []).map((j: any) => {
    const text = htmlToText(j.content ?? "");
    const loc = [j.location?.name, ...(j.offices ?? []).map((o: any) => o.name)].filter(Boolean).join("; ");
    return {
      id: `gh:${token}:${j.id}`, company, title: j.title, location: loc,
      remote: /remote/i.test(loc), url: j.absolute_url, posted: day(j.first_published ?? j.updated_at),
      pay: payFromText(text), text,
    };
  });
}

async function ashby(company: string, token: string): Promise<Job[]> {
  const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}?includeCompensation=true`);
  return (d.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => {
    const locs = [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean);
    const text = j.descriptionPlain || htmlToText(j.descriptionHtml ?? "");
    return {
      id: `ab:${token}:${j.id}`, company, title: j.title, location: locs.join("; "),
      remote: !!j.isRemote || j.workplaceType === "Remote" || /remote/i.test(locs.join(" ")),
      url: j.jobUrl, posted: day(j.publishedAt),
      pay: j.compensation?.compensationTierSummary || j.compensation?.scrapeableCompensationSalarySummary || payFromText(text), text,
    };
  });
}

async function lever(company: string, token: string): Promise<Job[]> {
  const d = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
  return (Array.isArray(d) ? d : []).map((j: any) => {
    const loc = [j.categories?.location, ...(j.categories?.allLocations ?? [])].filter(Boolean).join("; ");
    const text = [j.descriptionPlain, ...(j.lists ?? []).map((l: any) => l.text + "\n" + htmlToText(l.content ?? "")), j.additionalPlain].filter(Boolean).join("\n");
    const sr = j.salaryRange;
    return {
      id: `lv:${token}:${j.id}`, company, title: j.text, location: loc,
      remote: j.workplaceType === "remote" || /remote/i.test(loc), url: j.hostedUrl, posted: day(j.createdAt),
      pay: sr ? `$${Math.round(sr.min / 1000)}K–$${Math.round(sr.max / 1000)}K` : payFromText(text), text,
    };
  });
}

const FETCHERS: Record<string, (c: string, t: string) => Promise<Job[]>> = { greenhouse, ashby, lever };

export async function fetchAll(list: [string, string, string][], onError: (msg: string) => void): Promise<Job[]> {
  const out: Job[] = [];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const [company, ats, token] = list[i++];
      try { out.push(...(await FETCHERS[ats](company, token))); }
      catch (e: any) { onError(`${company} (${ats}/${token}): ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

// Fetch one posting from a URL. Uses the ATS API when the URL is a known board, else strips the page HTML.
export async function fetchOne(url: string): Promise<Job> {
  let m = url.match(/greenhouse\.io\/(?:embed\/job_app\?for=)?([\w-]+)\/jobs\/(\d+)/) || url.match(/[?&]gh_jid=(\d+)/);
  if (m && m.length === 3) {
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`);
    const text = htmlToText(j.content ?? "");
    return { id: `gh:${m[1]}:${j.id}`, company: m[1], title: j.title, location: j.location?.name ?? "", remote: /remote/i.test(j.location?.name ?? ""), url, posted: day(j.first_published ?? j.updated_at), pay: payFromText(text), text };
  }
  m = url.match(/jobs\.ashbyhq\.com\/([^/]+)\/([0-9a-f-]{36})/);
  if (m) {
    const all = await ashby(decodeURIComponent(m[1]), m[1]);
    const j = all.find(x => x.id.endsWith(m![2]));
    if (!j) throw new Error("This Ashby posting is not listed any more (probably closed).");
    return j;
  }
  m = url.match(/jobs\.lever\.co\/([^/]+)\/([0-9a-f-]{36})/);
  if (m) {
    const all = await lever(m[1], m[1]);
    const j = all.find(x => x.id.endsWith(m![2]));
    if (!j) throw new Error("This Lever posting is not listed any more (probably closed).");
    return j;
  }
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`Could not open the page (${r.status}). Save the job text to a .txt file and pass that instead.`);
  const html = await r.text();
  const title = decode(html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "").trim();
  const text = htmlToText(html);
  return { id: url, company: new URL(url).hostname, title, location: "", remote: /remote/i.test(text), url, posted: "", pay: payFromText(text), text };
}
