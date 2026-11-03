// npm run help [command]: what each command does and which options it takes.
// Keep this in step with the commands in cli.ts, applied.ts, bank.ts, newprofile.ts and setup.ts.
import { L } from "./i18n.ts";

type T = [zh: string, en: string];
type Command = {
  name: string;
  args?: string;                       // what goes after `npm run <name> --`
  summary: T;                          // one line for the overview
  detail?: T;                          // a few lines for `help <name>`
  options?: [flag: string, desc: T][];
  examples?: string[];
};

const t = (x: T) => L(x[0], x[1]);
// padEnd by screen width: Chinese characters take two columns in a terminal.
const cols = (s: string) => [...s].reduce((n, ch) => n + (/[\u2E80-\uFFEF]/.test(ch) ? 2 : 1), 0);
const pad = (s: string, w: number) => s + " ".repeat(Math.max(1, w - cols(s)));
const C = { dim: "\x1b[2m", b: "\x1b[1m", c: "\x1b[36m", y: "\x1b[33m", r: "\x1b[0m" };

const GROUPS: [T, Command[]][] = [
  [["找职位", "Find jobs"], [
    {
      name: "scan",
      summary: ["抓所有公司的职位，跟简历比对打分，写报告", "Fetch every job board, score postings against your resume, write reports"],
      detail: ["报告写到 out/report.html（每次覆盖）和 out/日期.md / .json。第一次出现的职位标 NEW。\n用 --profile 临时换 profile 时，报告写到 out/<profile>/，不会覆盖你平时的报告。",
               "Writes out/report.html (replaced every run) and out/<date>.md / .json. Postings seen for the first time are marked NEW.\nWith a one-off --profile, reports go to out/<profile>/ so your usual report is left alone."],
      options: [
        ["--top <数量>", ["终端里显示前几个（默认 30）", "how many to show in the terminal (default 30)"]],
        ["--company <名字>", ["只抓名字里含这个词的公司", "only companies whose name contains this"]],
        ["--loose", ["也显示没写级别或年限的职位", "include postings that state no level or years"]],
        ["--anywhere", ["不限地点", "ignore location"]],
        ["--all", ["不过滤，全部打分（调试用）", "no filtering at all (for debugging)"]],
        ["--dump", ["另外把抓到的所有职位写到 out/all/日期.jsonl", "also write every fetched posting to out/all/<date>.jsonl"]],
      ],
      examples: ["npm run scan", "npm run scan -- --top 50 --loose", "npm run scan -- --profile it", "npm run scan -- --company quora"],
    },
    {
      name: "open",
      summary: ["用浏览器打开最近一次的网页报告", "Open the latest HTML report in your browser"],
      detail: ["加 --profile <名字> 打开那个 profile 的报告（out/<profile>/report.html）。", "Add --profile <name> to open that profile's report (out/<profile>/report.html)."],
      examples: ["npm run open", "npm run open -- --profile it"],
    },
    {
      name: "match",
      args: "<链接或 .txt>",
      summary: ["给单个职位打分，列出对上和缺的技能", "Score one posting and list matched and missing skills"],
      detail: ["Greenhouse / Ashby / Lever 的职位链接最好用。也可以把 JD 存成 .txt（第一行写职位名）。",
               "Greenhouse, Ashby and Lever posting links work best. Or save the job description as .txt (first line = job title)."],
      options: [["--company <名字>", ["用 .txt 时写上公司名", "company name to show when you pass a .txt file"]]],
      examples: ["npm run match -- https://jobs.ashbyhq.com/quora/...", "npm run match -- job.txt --company Quora"],
    },
    {
      name: "applied",
      args: "<职位链接>",
      summary: ["把投过的职位记到你的追踪表格里（带分数、地点、薪资）", "Add a posting you applied to as a row in your tracker sheet (with score, location, pay)"],
      detail: ["需要先装好 tracker/apps-script.gs，并在 config.local.json 里设 trackerWebhook 和 trackerToken（见 README）。链接已经在表里的，只更新状态。\njob-radar 读不到的网站（LinkedIn、Workday、公司自己的页面）：加上 --company 和 --role，这样没有分数。",
               "Needs tracker/apps-script.gs installed and trackerWebhook + trackerToken in config.local.json (see README). If the link is already in the sheet, only its status changes.\nFor sites job-radar can't read (LinkedIn, Workday, a company's own page), pass --company and --role; there is no score then."],
      options: [
        ["--resume <版本>", ["这次用的简历版本名（填到 Resume used 列）", "which resume version you sent (goes in the Resume used column)"]],
        ["--status <状态>", ["状态，默认 applied（也可以 oa、interview 等）", "status, default applied (also oa, interview, …)"]],
        ["--date <日期>", ["投递日期，默认今天", "date applied, default today"]],
        ["--note \"<备注>\"", ["备注", "a note"]],
        ["--company <名字>", ["公司名（读不到职位时必填）", "company (required when the posting can't be read)"]],
        ["--role <职位>", ["职位名（读不到职位时必填）", "job title (required when the posting can't be read)"]],
        ["--link <链接>", ["链接（不传职位链接时用）", "link, when you don't pass a posting URL"]],
      ],
      examples: ["npm run applied -- https://jobs.ashbyhq.com/quora/...", "npm run applied -- \"<url>\" --company \"Acme\" --role \"IT Support Specialist\" --resume Mercury"],
    },
  ]],
  [["简历", "Resume"], [
    {
      name: "bank",
      args: "<简历文件>",
      summary: ["从你现有的简历生成素材库 resume.local.json（给 tailor 用）", "Draft your bullet bank (resume.local.json) from the resume you have, for tailor"],
      detail: ["不用 AI：按简历的标题、日期、缩进和项目符号，把你自己的文字抄进素材库格式。PDF、.txt、.md 都可以。生成后自己检查，再把简历上放不下的条目补进去。",
               "No AI: it reads the layout (headings, dates, indents, bullet marks) and copies your own text into the bank format. PDF, .txt or .md. Check the result, then add the bullets that didn't fit on your resume."],
      options: [
        ["--out <文件>", ["写到别的文件（默认 resume.local.json）", "write to another file (default resume.local.json)"]],
        ["--force", ["已经有这个文件时覆盖", "replace the file if it exists"]],
      ],
      examples: ["npm run bank -- ~/Work/resume/Songya_Zhang_Resume.pdf"],
    },
    {
      name: "tailor",
      args: "<链接或 .txt>",
      summary: ["从素材库为这个职位挑内容，生成一页简历（HTML + PDF）", "Build a one-page resume for one posting from your bullet bank (HTML + PDF)"],
      detail: ["只从素材库（默认 resume.local.json）挑选和排序，不会编新内容。结果写到 out/tailored/<公司>-<职位>/，旁边有 notes.md 说明选了什么、缺什么。\n生成 PDF 需要电脑上有 Chrome。",
               "Only picks and orders bullets from your bank (resume.local.json by default); nothing new is written. Output goes to out/tailored/<company>-<title>/ with a notes.md on what was chosen and what is missing.\nThe PDF needs Chrome installed."],
      options: [
        ["--bank <文件>", ["用别的素材库文件", "use another bullet-bank file"]],
        ["--out <文件夹>", ["换输出文件夹", "write to another folder"]],
        ["--no-pdf", ["只生成 HTML", "HTML only, no PDF"]],
        ["--company <名字>", ["用 .txt 时写上公司名", "company name when you pass a .txt file"]],
      ],
      examples: ["npm run tailor -- https://jobs.lever.co/acme/...", "npm run tailor -- job.txt --company Acme --no-pdf"],
    },
    {
      name: "skills",
      summary: ["看简历里认出了哪些技能", "Show which skills were found in your resume"],
      detail: ["漏了某个技能：在简历里写明，或者在 profile 的 skills 里加别名。", "If one is missing, spell it out in your resume or add an alias to the profile's skills."],
      examples: ["npm run skills", "npm run skills -- --resume other.pdf"],
    },
  ]],
  [["设置和职业 profile", "Setup and career profiles"], [
    {
      name: "setup",
      summary: ["回答几个问题，生成 config.local.json", "Answer a few questions to write config.local.json"],
      examples: ["npm run setup"],
    },
    {
      name: "profiles",
      summary: ["列出有哪些职业 profile（* 是你现在用的）", "List career profiles (* marks the one you use)"],
      options: [["--json", ["输出 JSON", "print JSON"]]],
      examples: ["npm run profiles"],
    },
    {
      name: "new-profile",
      args: "<名字> \"<描述>\"",
      summary: ["用本地 AI 模型（Ollama）起草一个新的职业 profile", "Draft a new career profile with a local AI model (Ollama)"],
      detail: ["名字只能用小写字母、数字和横线，比如 data-analyst。草稿写到 profiles/<名字>/，用之前自己检查一遍。",
               "Name: lowercase letters, digits and dashes, e.g. data-analyst. The draft goes to profiles/<name>/; check it before using it."],
      options: [
        ["--model <模型>", ["用哪个 Ollama 模型（默认 llama3.2:3b）", "which Ollama model (default llama3.2:3b)"]],
        ["--host <地址>", ["Ollama 地址（默认 http://localhost:11434）", "Ollama address (default http://localhost:11434)"]],
        ["--force", ["已经有同名 profile 时覆盖", "replace a profile with the same name"]],
      ],
      examples: ["npm run new-profile -- data-analyst \"entry-level data analyst, SQL and dashboards\""],
    },
    {
      name: "add-company",
      args: "<profile> <招聘页链接> [\"显示名\"]",
      summary: ["给某个 profile 加一家公司的招聘板（先确认能抓到）", "Add one employer's job board to a profile (checks it works first)"],
      detail: ["链接要在支持的招聘板上：Greenhouse、Ashby、Lever、Workday、SmartRecruiters、BambooHR、Oracle。打开公司招聘页里任意一个职位，用那个地址最稳。",
               "The link must be on a supported board: Greenhouse, Ashby, Lever, Workday, SmartRecruiters, BambooHR, Oracle. Opening any one posting on the careers page and using that address works best."],
      examples: ["npm run add-company -- it https://boards.greenhouse.io/acme \"Acme Corp\""],
    },
    {
      name: "dump",
      summary: ["只抓职位不打分，写到 out/all/（不需要简历）", "Fetch only, no scoring; writes out/all/ (no resume needed)"],
      detail: ["software 写到 out/all/日期.jsonl，其他 profile 写到 out/all/<profile>/日期.jsonl。", "software writes out/all/<date>.jsonl; other profiles write out/all/<profile>/<date>.jsonl."],
      examples: ["npm run dump", "npm run dump -- --profile it"],
    },
  ]],
];

const COMMON: [string, T][] = [
  ["--profile <名字>", ["这一次临时换一个职业 profile（比如 it）", "use another career profile for this run (e.g. it)"]],
  ["--resume <文件>", ["这一次用另一份简历", "use another resume file for this run"]],
  ["--level entry | mid | senior", ["这一次换经验级别（entry 应届/初级，mid 约 2–5 年，senior 5 年以上）", "use another experience level for this run (entry, mid about 2–5 years, senior 5+)"]],
  ["--lang en | zh", ["切换输出语言", "switch the output language"]],
  ["--help", ["看这个命令的详细说明", "show details for that command"]],
];

const ALL = GROUPS.flatMap(([, cmds]) => cmds);
export const COMMANDS = ALL.map(c => c.name);

// Placeholders like <数量> are written in Chinese; show English ones in English mode.
const PH: Record<string, string> = { "<数量>": "<n>", "<名字>": "<name>", "<文件>": "<file>", "<文件夹>": "<folder>", "<模型>": "<model>", "<地址>": "<url>",
  "<链接或 .txt>": "<URL or .txt>", "<职位链接>": "<posting URL>", "<简历文件>": "<resume.pdf | .txt | .md>", "<版本>": "<version>", "<状态>": "<status>", "<日期>": "<YYYY-MM-DD>", "\"<备注>\"": "\"<note>\"", "<职位>": "<title>", "<链接>": "<URL>", "\"<描述>\"": "\"<description>\"", "<招聘页链接>": "<careers page URL>", "[\"显示名\"]": "[\"Display name\"]" };
const ph = (s: string) => L(s, Object.entries(PH).reduce((a, [zh, en]) => a.split(zh).join(en), s));
const usage = (c: Command) => `npm run ${c.name}${c.args ? ` -- ${ph(c.args)}` : ""}`;

function overview() {
  console.log(`${C.b}job-radar${C.r}  ${C.dim}${L("从公开招聘板抓职位，跟你的简历比对打分", "pull postings from public job boards and score them against your resume")}${C.r}\n`);
  const width = Math.max(...ALL.map(c => c.name.length)) + 2;
  for (const [title, cmds] of GROUPS) {
    console.log(`${C.b}${t(title)}${C.r}`);
    for (const c of cmds) console.log(`  ${C.c}${c.name.padEnd(width)}${C.r}${t(c.summary)}`);
    console.log("");
  }
  console.log(`${C.b}${L("任何命令都能加", "Works with any command")}${C.r}`);
  for (const [f, d] of COMMON) console.log(`  ${pad(ph(f), 32)}${t(d)}`);
  console.log(`\n${C.dim}${L(
    "看某个命令的详细用法：npm run help -- scan   或   npm run scan -- --help\n参数要写在 -- 后面，比如 npm run scan -- --top 50",
    "Details for one command: npm run help -- scan   or   npm run scan -- --help\nOptions go after --, e.g. npm run scan -- --top 50")}${C.r}`);
}

function one(c: Command) {
  console.log(`${C.b}${usage(c)}${C.r}\n${t(c.summary)}`);
  if (c.detail) console.log(`\n${t(c.detail)}`);
  if (c.options?.length) {
    console.log(`\n${C.b}${L("选项", "Options")}${C.r}`);
    const width = Math.max(...c.options.map(([f]) => cols(ph(f)))) + 2;
    for (const [f, d] of c.options) console.log(`  ${C.c}${pad(ph(f), width)}${C.r}${t(d)}`);
  }
  if (c.examples?.length) {
    console.log(`\n${C.b}${L("例子", "Examples")}${C.r}`);
    for (const e of c.examples) console.log(`  ${e}`);
  }
  console.log(`\n${C.dim}${L("也可以加 --profile、--resume、--level、--lang。所有命令：npm run help", "Also takes --profile, --resume, --level, --lang. All commands: npm run help")}${C.r}`);
}

export function showHelp(topic?: string, unknown?: string) {
  if (unknown) console.log(`${C.y}${L(`没有 "${unknown}" 这个命令。`, `There is no "${unknown}" command.`)}${C.r}\n`);
  const c = topic ? ALL.find(x => x.name === topic) : undefined;
  if (topic && !c) console.log(`${C.y}${L(`没有 "${topic}" 这个命令。`, `There is no "${topic}" command.`)}${C.r}\n`);
  c ? one(c) : overview();
}
