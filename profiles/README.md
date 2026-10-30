# Career profiles

Each folder here is one career path. A profile tells job-radar which skills to look for, which job titles count, and which job boards to fetch.

| Profile | For |
|---|---|
| `software` | Entry-level software engineering: new grad, junior, early-career engineer/developer |
| `it` | IT support and systems administration: help desk, desktop support, IT technician, systems/network administrator, MSP |

Pick one with `"profile"` in `config.local.json` (`npm run setup` asks), or try one for a single run with `--profile <name>`. A one-off run writes to `out/<name>/`, so your own report is left alone.

## Files

```
profiles/<name>/
  profile.json     skills, title rules, scoring tweaks
  companies.json   job boards to fetch
```

### profile.json

| Key | What it does |
|---|---|
| `name`, `description` | Shown by `npm run profiles` and `npm run setup`. |
| `skills` | `{"name", "pattern", "core"}` list. `pattern` is a regular expression tested against lowercase text (in JSON, write `\\b` for `\b`). `core` skills count double in the resume score. Put alternatives in one pattern (`"vmware|hyper-?v"`) when knowing one of them is enough. |
| `alternatives` | Skill names where "X, Y or Z" in a posting means any one is enough (used for programming languages). |
| `gapPenalty` | Required skills that cost 10 points each when missing from the resume. |
| `bonus` | Up to 20 fit points: 20 if the posting mentions any `full` skill, else 10 per `partial` skill. `label` names it in reports. |
| `entryTitle` | Extra title words, as a regular expression, that mark an entry or early-career role. |
| `searchTerms` | Search words for Workday, SmartRecruiters and Oracle boards, which are searched instead of listed in full. |
| `defaults` | Default search rules: `includeTitle` / `excludeTitle` (plain text found in the title), `includeTitleRe` / `excludeTitleRe` (regular expressions, useful for short words like `\\bit\\b`), `excludeText`, `maxYears`, `requireLevel` (drop postings that state no level or years), `maxTitleLevel` (1 drops "II" and up, 2 drops "III" and up). Any of these can be overridden in `config.local.json`. |

### companies.json

```json
{ "companies": [["Display name", "board type", "token"]] }
```

| Board type | Token | Example career page |
|---|---|---|
| `greenhouse` | board name | `boards.greenhouse.io/quora` → `quora` |
| `ashby` | board name | `jobs.ashbyhq.com/quora` → `quora` |
| `lever` | company name | `jobs.lever.co/acme` → `acme` |
| `workday` | `tenant.wdN/site` | `acme.wd5.myworkdayjobs.com/AcmeCareers` → `acme.wd5/AcmeCareers` |
| `smartrecruiters` | company id | `jobs.smartrecruiters.com/Acme1` → `Acme1` |
| `bamboohr` | subdomain | `acme.bamboohr.com/careers` → `acme` |
| `oracle` | `host/site` | `abcd.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1` → `abcd.fa.us2/CX_1` |

Find a company's board by opening a posting on its careers page and looking at the address.

## Adding a profile

1. Copy `software` (or the closest profile) to a new folder, e.g. `profiles/nursing`.
2. Edit `profile.json`: replace the skills, title rules and description.
3. Edit `companies.json`: list employers that hire for that career, on the board types above.
4. Try it: `npm run skills -- --profile nursing --resume path/to/resume.pdf`, then `npm run scan -- --profile nursing`.
5. Pull requests with new profiles are welcome.
