# job-radar

[English](README.md) · 中文

从雇主公开的招聘板（Greenhouse、Ashby、Lever、Workday、SmartRecruiters、BambooHR、Oracle 的公开 API），以及社区维护、每天更新的 [SimplifyJobs 应届生职位列表](https://github.com/SimplifyJobs/New-Grad-Positions)（补上你名单之外几百家公司的新职位）抓职位，再用关键词规则跟你的简历比对打分。只在本地运行，不登录任何网站，不投递，不填表，简历和结果都不离开你的电脑。

**职业 profile**：选你要找的工作类型。目前有 `software`（软件工程，默认找应届和初级，可以改成 mid 或 senior）和 `it`（IT 支持和系统管理）。一个 profile 就是两个 JSON 文件，加新职业不用改代码，见 [profiles/](profiles/README.md)。

## 用法

需要 [Node.js](https://nodejs.org) 23.6 或更新版本（直接运行 TypeScript）和 [Git](https://git-scm.com)。macOS、Windows、Linux 都能用。

第一次使用：
```bash
git clone https://github.com/sophiazhangio/job-radar
cd job-radar
npm install
npm run setup     # 回答几个问题：职业 profile、经验级别、简历文件、城市等，生成 config.local.json
```

```bash
npm run help                      # 列出所有命令；npm run help -- scan 看单个命令的参数
npm run scan                      # 抓全部公司，按匹配度排序，报告写到 out/日期.md
npm run scan -- --top 50          # 终端多显示几个
npm run scan -- --company quora   # 只抓某家公司
npm run scan -- --loose           # 也显示没写级别/年限的职位
npm run scan -- --level senior    # 临时按另一个经验级别找一次（entry / mid / senior）
npm run scan -- --dump            # 另外把抓到的所有职位写到 out/all/日期.jsonl
npm run match -- <职位链接>       # 给单个职位打分（Greenhouse/Ashby/Lever 链接最准，其他网页也能试）
npm run match -- job.txt          # 把 JD 复制进 txt 文件也行
npm run bank -- resume.pdf       # 从你现有的简历生成素材库草稿（resume.local.json）
npm run tailor -- <职位链接>      # 从你的素材库为这个职位生成一页简历（见下面）
npm run skills                    # 看简历里认出了哪些技能（建议第一次先跑这个）
npm run profiles                  # 看有哪些职业 profile
npm run dump -- --profile it      # 只抓不打分，写到 out/all/<profile>/日期.jsonl（不需要简历）
npm run new-profile -- <名字> "<描述>"   # 用本地 AI 模型起草新的职业 profile（见 profiles/）
npm run add-company -- <profile> <招聘页链接>  # 加一家公司的招聘板，会先检查能不能抓
npm run open                      # 打开网页报告
```

命令要在 `job-radar` 文件夹里运行。链接要加引号（`"https://...?src=Linkedin"`）：Mac 默认的 zsh 里，没加引号的链接带 `?` 会报 *no matches found*。

每次 `scan` 都会生成：
- `out/report.html`：网页报告，每次覆盖成最新结果。`npm run open` 或双击打开，可以按地点、匹配度、发布时间（24 小时、3 天、一周、两周、一个月内）筛选，按分数或日期排序，搜索，点开看详情。纯本地文件，不联网，不用 AI。
- `out/日期.md` 和 `out/日期.json`：文字版报告，保留最近 `keepDays` 天（默认 7，在 `config.local.json` 里改；设成 0 只留当天）。
- `out/all/日期.jsonl`：只在加 `--dump` 或配置里 `"dump": true` 时生成，抓到的全部职位，一行一个 JSON。保留 `dumpKeepDays` 天（默认 30）。[echolocate](https://github.com/sophiazhangio/echolocate) 用它做语义搜索和技能趋势。

某个职位第一次出现的那一天会标 **NEW**（记录在 `.cache/seen.json`）。

## 和追踪表连起来

如果你用的投递追踪表能导出 `tracked.json`（作者用的是一个 claude.ai 页面上的「导出给 job-radar」按钮），job-radar 每次扫描时会自动找最新的那份（项目文件夹或 `~/Downloads` 里的 `tracked.json`、`tracked (1).json` 等），然后：

- 已在追踪表里的职位标出状态，比如「已投 10/29」「面试中」，不再标 NEW。
- 状态是「被拒」「职位已关」「不投了」的职位不再显示。
- 网页报告里可以勾「隐藏已追踪」，只看还没处理的。

投完一个职位，`npm run applied -- <职位链接>` 会在表格表头下面加一行（最新的在最上面），填好公司、职位、job-radar 分数、状态 `applied`、今天的日期、地点、薪资和链接；"Resume used" 在表格里自己选，或者加 `--resume 版本`。链接已经在表里的，只更新状态。job-radar 读不到的网站（LinkedIn、Workday、公司官网）加 `--company "公司" --role "职位"`。第一次设置：[复制模板表格](https://docs.google.com/spreadsheets/d/1j97SFV3VwCCc2JOh4j3WebtB0BNmRJbOHeXcxXt_iv8/copy)（栏位、状态选单、天数和统计行都做好了，脚本也会一起复制），在扩展程序 → Apps Script 里把 `TOKEN` 从 `change-me` 改成你自己的一串随机字，再部署成网页应用，步骤见英文 README 的 "Adding applications to the sheet"。

追踪表更新后想同步，就再导出一次。全程不用 AI，不用登录。文件格式见英文 README 的 "tracked.json format"。

也可以直接用表格，不用导出：在 `config.local.json` 里把 `"tracker"` 设成 Google 表格链接（共享 → 一般访问权限 → 「知道链接的任何人」可查看）、CSV 链接或本地 `.csv` 文件，每次扫描都读最新的。按表头认栏位：Company、Role、Link、Status、Applied、Follow-up，其他栏不管。

## 按职位生成简历

`npm run tailor -- <职位链接 或 job.txt>` 为一个职位生成一页简历。

1. 运行 `npm run bank -- 简历.pdf`（.txt、.md 也行），从你现有的简历生成 `resume.local.json`（不进 git）草稿。它按版面（标题、日期、缩进、项目符号）读出你的原文，不用 AI。检查一遍，再把它扩充成你的**素材库**；也可以从 `resume.example.json` 开始手写。素材库是所有可能用上的经历要点，可以比一页多。每条可以有几种写法（`alt`）和额外的 `tags`（这条体现了、但字面上没写出来的技能）。一定要出现的标 `pin`，每段经历用 `min` / `max` 控制条数。某一节设 `pick: 2`，就只留最匹配的两项（比如项目）。
2. tailor 读职位，用和 `match` 一样的规则找出必须项和加分项技能，给每条打分：必须项 3 分（核心技能 6 分），加分项 1 分（核心 2 分），职位里的关键词每个 1 分。每段经历留分最高的几条和最合适的写法，选最接近的 `title` 和 `summary`，技能栏里对上的技能排到前面。
3. 生成 HTML，用 Chrome 打印成 PDF。超过一页就删掉分最低的一条，再打印。
4. 像 `match` 一样给结果打分，显示改前（你现在的简历文件）和改后的简历分。

结果在 `out/tailored/<公司>-<职位>/`：HTML、PDF 和 `notes.md`（分数、对上的技能、素材库里没有的必须项、删掉了什么、每条入选内容的分数）。

选项：`--bank <文件>`（或在 `config.local.json` 里设 `"bank"`）、`--out <文件夹>`、`--no-pdf`、`.txt` 职位用 `--company <公司名>`。会自动找 Chrome、Chromium 或 Edge；找不到就在 `config.local.json` 里设 `"chrome"` 或设环境变量 `CHROME_PATH`。

tailor 只从你写的内容里挑选、排序、选写法，不会加你没有的技能：缺的必须项会写在 `notes.md` 里，不会写进简历。投之前自己读一遍。

## 改设置

- `config.local.json`（`npm run setup` 生成）：profile、经验级别 `level`（`entry` 默认，应届和初级；`mid` 约 2–5 年，II/III 级；`senior` 5 年以上，senior/staff/lead；临时试一次可以加 `--level senior`）、简历路径、毕业时间（可不填）、最多几年经验、可接受的城市（`locations.label` 是报告里这组城市的名字，比如 "LA/OC"；`locations.states` 可以填整个州）、职位最多发布了几天（`maxAgeDays`，默认 30）、最低分、输出语言（`lang`：`zh` 中文，`en` 英文；也可以在命令后加 `--lang zh`）。profile 里 `defaults` 的任何规则（标题排除词等）复制到这里就能覆盖。
- `profiles/<名字>/profile.json`：这个职业的技能词典、标题规则和打分细节。简历或 JD 里的写法没认出来，就在这里加。
- `profiles/<名字>/companies.json`：要抓的公司。`software` 名单偏 AI、开发者工具、金融科技和 LA 公司；`it` 名单偏橙县和 LA 的雇主。怎么找一家公司的招聘板见 [profiles/README.md](profiles/README.md)。
- 想临时试另一个 profile：命令后加 `--profile it`，结果写到 `out/it/`，不会覆盖你自己的报告。

## 选你想看的职位

都在 `config.local.json` 里，前两项 `npm run setup` 会问。

- **经验级别**（`"level"`）：

  | | `entry`（默认） | `mid` | `senior` |
  |---|---|---|---|
  | 标题 | 去掉 senior、staff、lead 和 II 级以上 | 留 II/III 级和 mid-level，去掉 new grad | 留 senior、staff、lead、principal，去掉 junior 和 new grad |
  | 要求年限 | 最多 2 年 | 2–5 年最高分 | 5 年以上最高分 |
  | 没写级别的职位 | 去掉 | 保留 | 保留 |
  | SimplifyJobs 应届生列表 | 用 | 不用 | 不用 |

  manager、director、实习在每个级别都会去掉。想临时试一次：`npm run scan -- --level mid`。
- **地点**（`"locations"`）：`remoteUS` 是美国远程，`cities` 是地点里出现的城市名（"irvine"、"santa monica"），`states` 是整个州（`["CA", "WA"]` 或 `["California"]`；"Toronto, ON, CA" 不算加州）。`label` 是报告里这组地点的名字。
- **多新的职位**（`"maxAgeDays"`，默认 30）：第一次发布超过这么多天的职位不显示；没写日期的保留。网页报告里的「发布时间」筛选可以再缩小。
- **哪些公司**：profile 的 `companies.json`。在 LinkedIn 上看到 job-radar 没抓到的职位？点进去找到公司自己的招聘页链接，然后 `npm run add-company -- software "<那个链接>"`，以后这家公司的职位都会抓。支持哪些招聘系统见 [profiles/README.md](profiles/README.md)。
- **SimplifyJobs 列表**（`software` profile）：社区维护、每天更新的应届生职位列表，覆盖几百家公司，能补上你名单之外的很多新职位。就是 `companies.json` 里 `simplify` 那一行，删掉就不用；把 `days=30` 改大可以往前多看几天。

## 打分怎么算

每个职位有两个分数，满分都是 100：

**简历分**：你的简历覆盖了多少职位要求的技能。
- 职位描述会被拆成「要求」和「加分项」两部分（按 Requirements / Nice to have / Preferred 这类小标题和 "a plus" 这类字眼）。
- 要求里的技能占 75 分，加分项占 25 分。主力语言和框架算 2 倍。
- "Python、Java 或 Go 任选一种" 这种写法，你有其中一种就不算缺。
- 要求里有你没写过的语言（Go、Rust、Kotlin 等），每个 -10。
- 显示为「简历 89（必须项对上 5/6）」。职位只写了一两个技能时，分数参考价值低，会有提示。

**条件分**：职位合不合你的求职条件。
- 级别 50：写了初级岗字眼，或要求年限在你的 `maxYears` 以内得高分，刚好到上限给一部分。`mid` 和 `senior` 下，要求年限在你范围内的最高，应届岗反而低。
- 地点 30：远程（美国）或你的城市。
- profile 加分 20：`software` 看 Claude Code / Codex / Cursor（满分）和 LLM、agent（一部分）；`it` 看 Microsoft 365、Windows Server、Azure 和 MSP 经验。
- 填了毕业时间时，毕业时间窗口看起来不包含你，-40。

**总分** = 60% 简历分 + 40% 条件分，用来排序。70 以上 Strong，50 以上 Good。

**简历里没有的词**：职位要求里出现、但你简历里一次都没出现的技术词和短语（比如 "design systems"、"cloudflare workers"）。很多公司先用招聘系统按关键词筛简历，可以把这些词交给改简历时参考。

直接过滤掉的（规则来自 profile，再按你的 `level` 调整）：不属于这个职业的标题（`software` 的 entry 级别：Senior/Staff/Lead、II 级以上、实习、嵌入式/硬件；`it`：Senior/Lead/Manager、III 级以上、非 IT 的技术员）、提到安全审查或国防、地点不符、年限超过 `maxYears`、第一次发布超过 `maxAgeDays` 天的，以及 `software` entry 级别下没写级别也没写年限的（用 `--loose` 可以看到）。

这是关键词规则，不懂语义。分数只用来排序，投之前请自己读 JD。

## 许可证

MIT，见 [LICENSE](LICENSE)。
