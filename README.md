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
```

第二次运行 `scan` 起，新出现的职位会标 **NEW**（记录在 `.cache/seen.json`）。

## 改设置

- `config.json`：简历路径、毕业时间、最多几年经验、可接受的城市、标题和正文的排除词、最低分。
- `companies.json`：要抓的公司。格式 `["显示名", "greenhouse|ashby|lever", "板子名"]`，板子名就是招聘页网址里那一段，比如 `jobs.ashbyhq.com/quora` 的 `quora`。
- `src/skills.ts`：技能词典。简历或 JD 里的写法没认出来，就在这里加。

## 打分怎么算

满分 100：

| 部分 | 分值 | 怎么算 |
|---|---|---|
| 技能 | 45 | JD 里出现的技能有多少在你简历上（主力语言/框架算 2 倍） |
| 级别 | 25 | 写了 new grad / junior / early career / 0–2 年得高分；要求 2 年给一部分；超过 `maxYears` 直接过滤 |
| 地点 | 15 | 远程（美国）或 LA/OC 城市 |
| AI 相关 | 10 | 提到 LLM、agent、Claude Code / Codex / Cursor |

扣分：毕业时间窗口看起来不包含你（-15），标题里要你没写过的语言（每个 -5）。70 分以上算 Strong，50 以上算 Good。

直接过滤掉的：Senior/Staff/Lead 等标题、II 级以上、实习、嵌入式/硬件/C++、提到安全审查或国防、地点不符、没写级别也没写年限（用 `--loose` 可以看到）。

这是关键词规则，不懂语义。分数只用来排序，投之前请自己读 JD。
