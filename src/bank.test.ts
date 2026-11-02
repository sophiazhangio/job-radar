import { test } from "node:test";
import assert from "node:assert/strict";
import { draftBank, textLines, headingOf } from "./bank.ts";

const resume = `Jamie Chen
jamie@example.com | 555-201-3344 | github.com/jchen

SUMMARY
Recent graduate who builds web apps.

EXPERIENCE
Data Analyst Intern, Brightside Health    Jun 2025 - Aug 2025
- Built SQL dashboards in Looker
- Cleaned 2M rows of claims data with pandas and documented the
  pipeline for the next intern
Teaching Assistant, CS 101    Jan 2024 - May 2025
- Held weekly office hours

SKILLS
Languages: Python, SQL, JavaScript
Tools: pandas, Git (GitHub Actions, hooks)
`;

test("plain-text resume becomes a bank", () => {
  const b = draftBank(textLines(resume));
  assert.equal(b.name, "Jamie Chen");
  assert.deepEqual(b.contact?.[0].map(c => c.text), ["jamie@example.com", "555-201-3344", "github.com/jchen"]);
  assert.equal((b.summary as { text: string }[])[0].text, "Recent graduate who builds web apps.");
  const exp = b.sections.find(s => s.heading === "Experience")!;
  assert.equal(exp.entries!.length, 2);
  assert.equal(exp.entries![0].title, "Data Analyst Intern, Brightside Health");
  assert.equal(exp.entries![0].date, "Jun 2025 - Aug 2025");
  assert.deepEqual(exp.entries![0].bullets!.map(x => (x as { text: string }).text), [
    "Built SQL dashboards in Looker",
    "Cleaned 2M rows of claims data with pandas and documented the pipeline for the next intern",
  ]);
  const skills = b.sections.find(s => s.heading === "Skills")!.skills!;
  assert.deepEqual(skills[1], { label: "Tools", items: ["pandas", "Git (GitHub Actions, hooks)"] });
});

test("headings: known names, letter-spaced and all caps", () => {
  const h = (text: string, caps = true) => headingOf({ text, x: 0, end: 0, size: 0, lead: "" }, caps);
  assert.equal(h("E X P E R I E N C E"), "Experience");
  assert.equal(h("Work Experience:"), "Work Experience");
  assert.equal(h("VOLUNTEER WORK"), "Volunteer Work");
  assert.equal(h("MARIO GONZALEZ", false), null);
  assert.equal(h("Software Engineer Intern\tMay 2025"), null);
});
