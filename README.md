# job-radar

English · [中文](README.zh-CN.md)

A local command-line tool that pulls job postings straight from employers' public job boards and ranks them against your resume.

- **Career profiles:** pick the kind of job you want. It comes with `software` (entry-level software engineering) and `it` (IT support and systems administration), and a profile is just two JSON files, so more can be added without code. See [profiles/](profiles/README.md).
- **Sources:** the public job-board APIs of Greenhouse, Ashby, Lever, Workday, SmartRecruiters, BambooHR and Oracle Recruiting, the systems behind most employers' career pages. No login, no scraping of LinkedIn or Indeed, and nothing is submitted anywhere.
- **Matching:** keyword and rule based. It reads your resume PDF, finds the skills on it, and scores each posting on how well your resume covers it and how well it fits what you are looking for.
- **Output:** a filterable HTML report, a Markdown/JSON report, and a short list in the terminal.
- **Tailored resumes:** `npm run tailor` builds a one-page resume for one posting from a bank of bullets you wrote, choosing the ones that match it best. No AI; it never writes new claims.
- **Private:** everything runs on your computer. Your resume, settings and results never leave it.
- **Cost:** free. Scanning and scoring use no AI or paid API (only the optional `new-profile` draft uses a local model); one run of ~100 companies (~11,000 postings) takes about 10 seconds.

> Output is in English by default. Set `"lang": "zh"` in `config.local.json` (or pass `--lang zh`) for Chinese.

## Quick start

Requires [Node.js](https://nodejs.org) 23.6 or newer (it runs TypeScript directly, no build step) and [Git](https://git-scm.com). Works on macOS, Windows and Linux.

```bash
git clone https://github.com/sophiazhangio/job-radar
cd job-radar
npm install
npm run setup
```

`npm run setup` asks for your career profile, your resume file, the cities you would work in and a few limits, then writes `config.local.json` (kept out of git). You can edit that file later, or start from `config.example.json` instead. Then:

```bash
npm run scan                      # fetch every company, score, write reports
npm run open                      # open out/report.html
npm run match -- <posting URL>    # score one posting (Greenhouse/Ashby/Lever URLs work best)
npm run match -- job.txt          # or a job description saved as text
npm run tailor -- <posting URL>   # one-page resume for this posting from your bullet bank (see below)
npm run skills                    # show which skills were found in your resume
npm run profiles                  # list career profiles
npm run dump -- --profile it      # fetch only, write out/all/<profile>/<date>.jsonl (no resume needed)
npm run new-profile -- <name> "<description>"   # draft a new career profile with a local AI model (see profiles/)
npm run add-company -- <profile> <careers page URL>  # add one employer's job board, after checking it works
```

Run `npm run skills` first: if a skill you have is not found, add it to your resume in plain words or add an alias to your profile's `skills`.

Useful `scan` flags: `--top 50` (show more in the terminal), `--company quora` (one company), `--loose` (include postings that state no level or years), `--anywhere` (ignore location), `--all` (no filtering, for debugging), `--dump` (also write every fetched posting to `out/all/<date>.jsonl`).

## What a run produces

- `out/report.html`: overwritten on every run. Filter by location and match level, sort by score or date, search, and expand a posting to see matched skills, missing skills and keywords.
- `out/<date>.md` and `out/<date>.json`: kept for `keepDays` days (default 7).
- `out/all/<date>.jsonl` (only with `--dump` or `"dump": true` in the config): every fetched posting, one JSON object per line (`id, company, title, location, remote, url, posted, pay, description`). Kept for `dumpKeepDays` days (default 30). Profiles other than `software` write to `out/all/<profile>/` instead. [echolocate](https://github.com/sophiazhangio/echolocate) reads these for semantic search and skill trends.
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
- Level (50): entry-level wording or years within your `maxYears` score high; the top of your range partly.
- Location (30): remote in the US or one of your cities.
- Profile bonus (20): for `software`, mentions of Claude Code, Codex or Cursor score full and LLMs or agents partly; for `it`, Microsoft 365, Windows Server, Azure and MSP work.
- If you set a graduation month, a graduation window that seems to exclude you costs 40.

**Total** = 60% resume + 40% fit, used for ranking. 70+ is *Strong*, 50+ *Good*.

**Keywords missing from your resume**: technical terms and phrases that appear in the posting's requirements but nowhere in your resume (e.g. "design systems", "cloudflare workers"), useful when tailoring a resume.

Filtered out before scoring (rules come from the profile): titles outside the profile (for `software`: senior/staff/lead/manager, level II and up, internships, embedded/hardware; for `it`: senior/lead/manager, level III and up, non-IT technicians), postings that mention security clearances or defense, locations outside your list, more years than `maxYears`, and, for `software`, postings with no level or years stated (see them with `--loose`).

It is keyword matching and does not understand meaning. Use the score to decide what to read first, not whether to apply.

## Tailored resumes

`npm run tailor -- <posting URL or job.txt>` builds a one-page resume for one posting.

1. Copy `resume.example.json` to `resume.local.json` (gitignored) and write your own **bullet bank**: every bullet you could use, more than fits on a page. A bullet can have alternate wordings (`alt`) and extra `tags` (skill words it shows that its text doesn't spell out). Mark bullets that must always appear with `pin`, and set `min` / `max` bullets per entry. A section with `pick: 2` keeps the two entries (say, projects) that match best.
2. tailor reads the posting, finds its required and nice-to-have skills (the same rules as `match`), and scores every bullet: required skills 3 points (core skills 6), nice-to-have 1 (core 2), posting keywords 1 each. It keeps the best bullets and wording per entry, picks the closest `title` and `summary`, and moves matching skills to the front of each skills line.
3. It writes HTML and prints a PDF with Chrome. If the PDF runs past one page it drops the lowest-scoring bullet and prints again.
4. It scores the result like `match` does and shows the resume score before (your current resume file) and after.

Output goes to `out/tailored/<company>-<title>/`: the HTML, the PDF and `notes.md` (scores, matched skills, required skills your bank doesn't cover, what was dropped, and every chosen bullet with its points).

Options: `--bank <file>` (or `"bank"` in `config.local.json`), `--out <folder>`, `--no-pdf`, `--company <name>` for a `.txt` posting. Chrome, Chromium or Edge is found automatically; set `"chrome"` in `config.local.json` or `CHROME_PATH` if it isn't.

tailor only picks, orders and chooses between wordings you wrote. It never adds a skill you don't have: missing required skills are listed in `notes.md`, not added. Read the result before you send it.

## Configuration

- `config.local.json` (gitignored; `npm run setup` writes it): profile, resume path, graduation month (optional), max years of experience, remote/city preferences (`locations.label` names your city list in reports, e.g. "LA/OC"), minimum score, report retention, output language (`lang`: `en` or `zh`). Any rule from the profile's `defaults` (title and text exclusions and so on) can be copied here to override it.
- `profiles/<name>/profile.json`: the skill dictionary, title rules and scoring tweaks for a career.
- `profiles/<name>/companies.json`: which boards to fetch. The `software` list leans toward AI, developer-tool, fintech and Los Angeles companies; the `it` list toward Orange County and Los Angeles employers. Add your own; [profiles/README.md](profiles/README.md) shows how to find a company's board.
- Use `"companies": "path/to/file.json"` in `config.local.json` to point at your own list instead.

## Adding applications to the sheet

`npm run applied -- <posting URL>` adds the posting to your tracker sheet as a new row under the header (newest first): company, role, job-radar score, status `applied`, today's date, location, pay and link. If `npm run tailor` made a resume for that company, "Resume used" is filled too. A posting whose link is already in the sheet only gets its status updated.

- Sites job-radar can't read (LinkedIn, Workday, a company's own page): `npm run applied -- "<url>" --company "Name" --role "Title"` (no score).
- Other options: `--status oa`, `--resume Mercury`, `--date 2026-10-28`, `--note "referral from Sam"`.

One-time setup: open your sheet → Extensions → Apps Script, paste [tracker/apps-script.gs](tracker/apps-script.gs), change `TOKEN` to any long random text, then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone) and approve. Put the web app URL in `config.local.json` as `"trackerWebhook"` and the same text as `"trackerToken"`. The sheet's columns are matched by header (Company, Role, Score, Status, Applied, Days, Resume used, Location, Pay, Link, Notes); missing ones are skipped.

## tracked.json format

**Or use a spreadsheet.** Set `"tracker"` in `config.local.json` to a Google Sheets link (Share → General access → "Anyone with the link" can view), any CSV URL, or a local `.csv` file, and the scan reads it instead of `tracked.json`. Columns are matched by header: Company, Role (or Title/Position), Link (or URL), Status, Applied, Follow-up; others are ignored. Dates like `10/30/2026` are fine.

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
profiles/        career profiles: skills, title rules, company lists
src/sources.ts   fetch Greenhouse / Ashby / Lever / Workday / SmartRecruiters / BambooHR / Oracle boards
src/score.ts     filters, required vs nice-to-have split, resume and fit scores, keyword gaps
src/skills.ts    profile loading and skill matching
src/setup.ts     npm run setup
src/resume.ts    resume text from PDF (unpdf), .txt or .md
src/tailor.ts    tailored resume: bullet scoring, HTML, PDF via Chrome (tests in tailor.test.ts)
src/tracked.ts   tracked.json lookup
src/html.ts      HTML report
src/cli.ts       commands and report writing
```

## Limitations

- Only employers listed in the profile's `companies.json`, on the seven supported boards, are covered. Employers on other systems (Paylocity, iCIMS, custom career sites) and jobs posted only on Indeed or LinkedIn are not.
- On Windows the keyword-gap list is noisier, because it uses the macOS/Linux word list to skip common English words.
- Location and level detection rely on how each posting is written and can be wrong. Open the posting before applying.

## License

MIT, see [LICENSE](LICENSE).
