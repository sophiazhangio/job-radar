# job-radar

从公开的招聘板（Greenhouse、Ashby、Lever 的公开 API）抓入门级软件岗位，再用关键词规则跟你的简历比对打分。只在本地运行，不登录任何网站，不投递，不填表。

## 用法

需要 Node.js 23.6 或更新版本（直接运行 TypeScript）。

```bash
npm install
npm run scan                      # 抓全部公司，按匹配度排序，报告写到 out/日期.md
npm run scan -- --top 50          # 终端多显示几个
npm run scan -- --company quora   # 只抓某家公司
npm run scan -- --loose           # 也显示没写级别/年限的职位
npm run match -- <职位链接>       # 给单个职位打分（Greenhouse/Ashby/Lever 链接最准，其他网页也能试）
npm run match -- job.txt          # 把 JD 复制进 txt 文件也行
npm run skills                    # 看简历里认出了哪些技能
npm run open                      # 打开网页报告
```

每次 `scan` 都会生成：
- `out/report.html`：网页报告，每次覆盖成最新结果。`npm run open` 或双击打开，可以按地点、匹配度筛选，按分数或日期排序，搜索，点开看详情。纯本地文件，不联网，不用 AI。
- `out/日期.md` 和 `out/日期.json`：文字版报告，保留最近 `keepDays` 天（默认 7，在 `config.json` 里改；设成 0 只留当天）。

某个职位第一次出现的那一天会标 **NEW**（记录在 `.cache/seen.json`）。

## 和追踪表连起来

在线的「求职投递追踪」页面上点「导出给 job-radar」，会下载一个 `tracked.json`。job-radar 每次扫描时会自动找最新的那份（项目文件夹或 `~/Downloads` 里的 `tracked.json`、`tracked (1).json` 等），然后：

- 已在追踪表里的职位标出状态，比如「已投 10/29」「面试中」，不再标 NEW。
- 状态是「被拒」「职位已关」「不投了」的职位不再显示。
- 网页报告里可以勾「隐藏已追踪」，只看还没处理的。

追踪表更新后想同步，就再点一次导出。全程不用 AI，不用登录。

## 改设置

- `config.json`：简历路径、毕业时间、最多几年经验、可接受的城市、标题和正文的排除词、最低分。
- `companies.json`：要抓的公司。格式 `["显示名", "greenhouse|ashby|lever", "板子名"]`，板子名就是招聘页网址里那一段，比如 `jobs.ashbyhq.com/quora` 的 `quora`。
- `src/skills.ts`：技能词典。简历或 JD 里的写法没认出来，就在这里加。

## 打分怎么算

每个职位有两个分数，满分都是 100：

**简历分**：你的简历覆盖了多少职位要求的技能。
- 职位描述会被拆成「要求」和「加分项」两部分（按 Requirements / Nice to have / Preferred 这类小标题和 "a plus" 这类字眼）。
- 要求里的技能占 75 分，加分项占 25 分。主力语言和框架算 2 倍。
- "Python、Java 或 Go 任选一种" 这种写法，你有其中一种就不算缺。
- 要求里有你没写过的语言（Go、Rust、Kotlin 等），每个 -10。
- 显示为「简历 89（必须项对上 5/6）」。职位只写了一两个技能时，分数参考价值低，会有提示。

**条件分**：职位合不合你的求职条件。
- 级别 50：写了 new grad / junior / early career / 0–2 年得高分，要求 2 年给一部分。
- 地点 30：远程（美国）或 LA/OC。
- AI 相关 20：提到 Claude Code / Codex / Cursor 得满分，提到 LLM、agent 得一部分。
- 毕业时间窗口看起来不包含你，-40。

**总分** = 60% 简历分 + 40% 条件分，用来排序。70 以上 Strong，50 以上 Good。

**简历里没有的词**：职位要求里出现、但你简历里一次都没出现的技术词和短语（比如 "design systems"、"cloudflare workers"）。很多公司先用招聘系统按关键词筛简历，可以把这些词交给改简历时参考。

直接过滤掉的：Senior/Staff/Lead 等标题、II 级以上、实习、嵌入式/硬件/C++、提到安全审查或国防、地点不符、没写级别也没写年限（用 `--loose` 可以看到）。

这是关键词规则，不懂语义。分数只用来排序，投之前请自己读 JD。
