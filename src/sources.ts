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

// Be polite to shared servers (many Workday employers share one host): at most 2 requests at a time per host,
// and when a server says "too many requests" (429) or is briefly down (503), wait and try again.
const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();
const PER_HOST = 2;
async function slot(host: string): Promise<() => void> {
  if ((active.get(host) ?? 0) >= PER_HOST) await new Promise<void>(r => waiting.set(host, [...(waiting.get(host) ?? []), r]));
  active.set(host, (active.get(host) ?? 0) + 1);
  return () => {
    active.set(host, (active.get(host) ?? 1) - 1);
    const next = waiting.get(host)?.shift();
    if (next) next();
  };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function request(url: string, init: RequestInit = {}): Promise<any> {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const release = await slot(host);
    let r: Response;
    try { r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20000) }); }
    finally { release(); }
    if ((r.status === 429 || r.status === 503) && attempt < 4) {
      const after = parseInt(r.headers.get("retry-after") ?? "", 10);
      await sleep(Number.isFinite(after) ? Math.min(after, 60) * 1000 : 2000 * 2 ** attempt);
      continue;
    }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
}

const getJson = (url: string) => request(url);
const postJson = (url: string, body: unknown) => request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });

// Run fn over items, at most n at a time.
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

// Options for boards that are searched rather than listed in full: search words, and a title
// filter applied before fetching each posting's details (big employers list thousands of jobs).
// placeOk skips postings whose listed location is clearly outside your search (checked before fetching details).
export type FetchOpts = { searchTerms: string[]; titleOk: (title: string) => boolean; placeOk?: (location: string) => boolean };
const placeOk = (o: FetchOpts, loc: string | undefined) => !loc || !o.placeOk || o.placeOk(loc);

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
      // Ashby sets isRemote on some hybrid/on-site jobs, so workplaceType wins when present.
      remote: j.workplaceType ? j.workplaceType === "Remote" : !!j.isRemote || /remote/i.test(locs.join(" ")),
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

// Workday career sites. token = "tenant.wdN/site", from a URL like https://tenant.wdN.myworkdayjobs.com/site
async function workday(company: string, token: string, o: FetchOpts): Promise<Job[]> {
  const [host, site] = token.split("/");
  const tenant = host.split(".")[0];
  const base = `https://${host}.myworkdayjobs.com`;
  const api = `${base}/wday/cxs/${tenant}/${site}`;
  const found = new Map<string, any>();
  for (const q of o.searchTerms.length ? o.searchTerms : [""]) {
    for (let offset = 0; offset < 200; offset += 20) {
      const d = await postJson(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: q });
      for (const p of d.jobPostings ?? []) if (p.externalPath && !found.has(p.externalPath)) found.set(p.externalPath, p);
      if (!d.jobPostings?.length || offset + 20 >= (d.total ?? 0)) break;
    }
  }
  const picked = [...found.values()].filter(p => o.titleOk(p.title ?? "") && placeOk(o, p.locationsText));
  const jobs = await mapLimit(picked, 4, async p => {
    try {
      const j = (await getJson(`${api}${p.externalPath}`)).jobPostingInfo ?? {};
      const text = htmlToText(j.jobDescription ?? "");
      const loc = [j.location ?? p.locationsText, ...(j.additionalLocations ?? [])].filter(Boolean).join("; ");
      return {
        id: `wd:${tenant}:${j.jobReqId ?? p.externalPath}`, company, title: j.title ?? p.title, location: loc,
        remote: /remote/i.test(`${j.remoteType ?? ""} ${loc}`), url: j.externalUrl ?? `${base}/${site}${p.externalPath}`,
        posted: j.startDate ? day(j.startDate) : "", pay: payFromText(text), text,
      } as Job;
    } catch { return null; }
  });
  return jobs.filter((j): j is Job => !!j);
}

// SmartRecruiters. token = the company id in https://jobs.smartrecruiters.com/<CompanyId>
async function smartrecruiters(company: string, token: string, o: FetchOpts): Promise<Job[]> {
  const api = `https://api.smartrecruiters.com/v1/companies/${token}/postings`;
  const found = new Map<string, any>();
  for (const q of o.searchTerms.length ? o.searchTerms : [""]) {
    for (let offset = 0; offset < 500; offset += 100) {
      const d = await getJson(`${api}?limit=100&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      for (const p of d.content ?? []) found.set(p.id, p);
      if (!d.content?.length || offset + 100 >= (d.totalFound ?? 0)) break;
    }
  }
  const picked = [...found.values()].filter(p => o.titleOk(p.name ?? "") && placeOk(o, [p.location?.city, p.location?.region, p.location?.country].filter(Boolean).join(", ")));
  const jobs = await mapLimit(picked, 4, async p => {
    try {
      const j = await getJson(`${api}/${p.id}`);
      const sec = j.jobAd?.sections ?? {};
      const text = ["jobDescription", "qualifications", "additionalInformation"].map(k => sec[k] ? `${sec[k].title ?? ""}\n${htmlToText(sec[k].text ?? "")}` : "").filter(Boolean).join("\n");
      const l = j.location ?? p.location ?? {};
      const loc = [l.city, l.region, l.country?.toUpperCase()].filter(Boolean).join(", ");
      return {
        id: `sr:${token}:${p.id}`, company, title: j.name ?? p.name, location: (l.remote ? "Remote; " : "") + loc,
        remote: !!l.remote, url: j.postingUrl ?? `https://jobs.smartrecruiters.com/${token}/${p.id}`,
        posted: day(j.releasedDate ?? p.releasedDate), pay: payFromText(text), text,
      } as Job;
    } catch { return null; }
  });
  return jobs.filter((j): j is Job => !!j);
}

// BambooHR career pages, common at small companies. token = the subdomain in https://<token>.bamboohr.com/careers
async function bamboohr(company: string, token: string, o: FetchOpts): Promise<Job[]> {
  const base = `https://${token}.bamboohr.com/careers`;
  const d = await getJson(`${base}/list`);
  const picked = (d.result ?? []).filter((p: any) => o.titleOk(p.jobOpeningName ?? ""));
  const jobs = await mapLimit(picked, 4, async (p: any) => {
    try {
      const j = (await getJson(`${base}/${p.id}/detail`)).result?.jobOpening ?? {};
      const text = htmlToText(j.description ?? "");
      const l = j.location ?? p.location ?? {};
      const loc = [l.city, l.state ?? l.addressState].filter(Boolean).join(", ");
      const remote = !!(j.isRemote ?? p.isRemote) || j.locationType === "1";
      return {
        id: `bh:${token}:${p.id}`, company, title: j.jobOpeningName ?? p.jobOpeningName, location: (remote ? "Remote; " : "") + loc,
        remote, url: j.jobOpeningShareUrl ?? `${base}/${p.id}`, posted: j.datePosted ? day(j.datePosted) : "",
        pay: j.compensation || payFromText(text), text,
      } as Job;
    } catch { return null; }
  });
  return jobs.filter((j): j is Job => !!j);
}

// Oracle Recruiting Cloud (many health systems). token = "host/site", from a URL like
// https://host.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/...  -> "host/CX_1" (e.g. "evac.fa.us2/CX_1")
async function oracle(company: string, token: string, o: FetchOpts): Promise<Job[]> {
  const [host, site] = token.split("/");
  const api = `https://${host}.oraclecloud.com/hcmRestApi/resources/latest`;
  const found = new Map<string, any>();
  for (const q of o.searchTerms.length ? o.searchTerms : [""]) {
    for (let offset = 0; offset < 100; offset += 25) {
      const finder = `findReqs;siteNumber=${site},limit=25,offset=${offset}${q ? `,keyword=${encodeURIComponent(q)}` : ""}`;
      const d = await getJson(`${api}/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${finder}`);
      const page = d.items?.[0]?.requisitionList ?? [];
      for (const r of page) found.set(r.Id, r);
      if (!page.length || offset + 25 >= (d.items?.[0]?.TotalJobsCount ?? 0)) break;
    }
  }
  const picked = [...found.values()].filter(r => o.titleOk(r.Title ?? "") && placeOk(o, r.PrimaryLocation));
  const jobs = await mapLimit(picked, 4, async r => {
    try {
      const d = (await getJson(`${api}/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${r.Id}%22,siteNumber=${site}`)).items?.[0] ?? {};
      const text = ["ExternalDescriptionStr", "ExternalResponsibilitiesStr", "ExternalQualificationsStr"].map(k => htmlToText(d[k] ?? "")).filter(Boolean).join("\n");
      const loc = d.PrimaryLocation ?? r.PrimaryLocation ?? "";
      const remote = /REMOTE/.test(d.WorkplaceTypeCode ?? r.WorkplaceTypeCode ?? "");
      return {
        id: `or:${host}:${r.Id}`, company, title: d.Title ?? r.Title, location: (remote ? "Remote; " : "") + loc, remote,
        url: `https://${host}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${site}/job/${r.Id}`,
        posted: day(r.PostedDate ?? d.ExternalPostedStartDate), pay: payFromText(text), text,
      } as Job;
    } catch { return null; }
  });
  return jobs.filter((j): j is Job => !!j);
}

const FETCHERS: Record<string, (c: string, t: string, o: FetchOpts) => Promise<Job[]>> = { greenhouse, ashby, lever, workday, smartrecruiters, bamboohr, oracle };

export async function fetchAll(list: [string, string, string][], onError: (msg: string) => void, opts: FetchOpts = { searchTerms: [], titleOk: () => true }): Promise<Job[]> {
  const out: Job[] = [];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const [company, ats, token] = list[i++];
      const fetcher = FETCHERS[ats];
      if (!fetcher) { onError(`${company}: unknown board type "${ats}"`); continue; }
      try { out.push(...(await fetcher(company, token, opts))); }
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
