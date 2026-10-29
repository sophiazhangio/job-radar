# job-radar

English · [中文](README.zh-CN.md)

A local command-line tool that pulls entry-level software postings straight from companies' public job boards and ranks them against your resume.

- **Sources:** the public job-board APIs of Greenhouse, Ashby and Lever, the applicant tracking systems behind many tech companies' career pages. No login, no scraping of LinkedIn or Indeed, and nothing is submitted anywhere.
- **Matching:** keyword and rule based. It reads your resume PDF, finds the skills on it, and scores each posting on how well your resume covers it and how well it fits what you are looking for.
- **Output:** a filterable HTML report, a Markdown/JSON report, and a short list in the terminal.
- **Cost:** free. No AI or paid API is involved; one run of ~100 companies (~11,000 postings) takes about 10 seconds.

> The terminal output, report page and Chinese README are in Chinese (the author's working language). Settings and code are in English.

## Quick start

Requires Node.js 23.6+ (it runs TypeScript directly, no build step).

```bash
git clone https://github.com/sophiazhangio/job-radar
cd job-radar
npm install
cp config.example.json config.local.json
```

Put your resume PDF in the folder (or anywhere) and set `resume`, `graduation` and `locations` in `config.local.json`. Then:

```bash
npm run scan                      # fetch every company, score, write reports
npm run open                      # open out/report.html
npm run match -- <posting URL>    # score one posting (Greenhouse/Ashby/Lever URLs work best)
npm run match -- job.txt          # or a job description saved as text
npm run skills                    # show which skills were found in your resume
```

Useful `scan` flags: `--top 50` (show more in the terminal), `--company quora` (one company), `--loose` (include postings that state no level or years), `--anywhere` (ignore location), `--all` (no filtering, for debugging).

## What a run produces

- `out/report.html`: overwritten on every run. Filter by location and match level, sort by score or date, search, and expand a posting to see matched skills, missing skills and keywords.
- `out/<date>.md` and `out/<date>.json`: kept for `keepDays` days (default 7).
- A posting is marked **NEW** on the day it first shows up (`.cache/seen.json`).

## How scoring works

Each posting gets two scores out of 100.

**Resume score**: how much of the posting your resume covers.
- The description is split into required and nice-to-have parts using headings such as *Requirements*, *Nice to have*, *Preferred* and phrases like *a plus*.
- Required skills are worth 75 points, nice-to-have skills 25. Core languages and frameworks count double.
- In "Python, Java or Go" style lists, having one of them is enough.
- Each required language you don't list (Go, Rust, Kotlin…) costs 10 points.
- Shown with a count, e.g. `89 (5/6 required)`, and flagged when a posting names only one or two skills.

**Fit score**: whether the posting fits what you want.
- Level (50): new grad / junior / early career / 0–2 years scores high; 2 years partly.
- Location (30): remote in the US or one of your cities.
- AI focus (20): mentions of Claude Code, Codex or Cursor score full; LLMs and agents partly.
- A graduation window that seems to exclude you costs 40.

**Total** = 60% resume + 40% fit, used for ranking. 70+ is *Strong*, 50+ *Good*.

**Keywords missing from your resume**: technical terms and phrases that appear in the posting's requirements but nowhere in your resume (e.g. "design systems", "cloudflare workers"), useful when tailoring a resume.

Filtered out before scoring: senior/staff/lead/manager titles, level II and up, internships, embedded/hardware/C++ titles, postings that mention security clearances or defense, locations outside your list, more years than `maxYears`, and postings with no level or years stated (see them with `--loose`).

It is keyword matching and does not understand meaning. Use the score to decide what to read first, not whether to apply.

## Configuration

- `config.local.json` (gitignored; start from `config.example.json`): resume path, graduation month, max years of experience, remote/city preferences, title and text exclusions, minimum score, report retention.
- `companies.json`: which boards to fetch, as `["Display name", "greenhouse" | "ashby" | "lever", "board token"]`. The token is the company part of the board URL, e.g. `quora` in `jobs.ashbyhq.com/quora`. The default list leans toward AI, developer-tool, fintech and Los Angeles companies; swap in your own.
- `src/skills.ts`: the skill dictionary and its aliases. Add an entry when a skill on your resume or in postings is not recognized.

## tracked.json format

If your application tracker can export a `tracked.json`, the scan picks up the newest one from the project folder or `~/Downloads` (including `tracked (1).json` and so on). Postings you track are labelled with their status, and those marked rejected, closed or skipped are hidden.

```json
{
  "jobs": [
    {
      "company": "Quora",
      "role": "Full Stack Software Engineer, New Grad",
      "url": "https://jobs.ashbyhq.com/quora/...",
      "status": "applied",
      "applied": "2026-10-29",
      "followUp": "2026-11-05"
    }
  ]
}
```

`status` is one of `saved`, `applied`, `oa`, `interview`, `offer`, `rejected`, `closed`, `skip`. Postings are matched by URL first, then by company and title.

## Project layout

```
src/sources.ts   fetch Greenhouse / Ashby / Lever boards, normalize postings
src/score.ts     filters, required vs nice-to-have split, resume and fit scores, keyword gaps
src/skills.ts    skill dictionary
src/resume.ts    resume text from PDF (unpdf), .txt or .md
src/tracked.ts   tracked.json lookup
src/html.ts      HTML report
src/cli.ts       commands and report writing
```

## Limitations

- Only companies on the three supported boards and listed in `companies.json` are covered; companies on Workday, Teamtailor or custom career sites are not.
- Location and level detection rely on how each posting is written and can be wrong. Open the posting before applying.

## License

MIT, see [LICENSE](LICENSE).
