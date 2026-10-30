import { test } from "node:test";
import assert from "node:assert/strict";
import { choose, dropOne, pickTitle, inline, countPages, toText, type Bank, type Want } from "./tailor.ts";

const bank: Bank = {
  name: "Test Person",
  title: ["Full-Stack Software Engineer", "Frontend Engineer"],
  summary: [{ text: "Backend person: Python and SQL." }, { text: "Frontend person: React and CSS." }],
  sections: [
    {
      heading: "Experience",
      entries: [{
        title: "Engineer", min: 1, max: 2,
        bullets: [
          { text: "Wrote SQL migrations in Postgres.", pin: true },
          "Built a Python data pipeline.",
          { text: "Made pages faster.", alt: ["Made React pages faster with CSS fixes."] },
          "Shipped accessible React components with ARIA labels.",
        ],
      }],
    },
    {
      heading: "Projects", pick: 1,
      entries: [
        { title: "ml-thing", bullets: ["PyTorch model."] },
        { title: "ui-thing", bullets: ["A React design system with CSS tokens."] },
      ],
    },
    { heading: "Skills", skills: [{ label: "Languages", items: ["Python", "SQL", "TypeScript"] }] },
  ],
};

const frontend: Want = { required: ["React", "HTML/CSS", "Accessibility"], nice: ["Design systems"], keywords: [], title: "Frontend Engineer - Design Systems" };

test("keeps pinned bullets and fills the rest with the best matches", () => {
  const c = choose(bank, frontend);
  const texts = c.sections[0].entries[0].bullets.map(b => b.text);
  assert.equal(texts.length, 2);
  assert.equal(texts[0], "Wrote SQL migrations in Postgres.");
  // React + CSS (both core) beats React + Accessibility
  assert.equal(texts[1], "Made React pages faster with CSS fixes.");
});

test("uses the alternate wording that matches better", () => {
  const c = choose({ ...bank, sections: [{ heading: "X", entries: [{ title: "E", bullets: [{ text: "Made pages faster.", alt: ["Made React pages faster with CSS fixes."] }] }] }] }, frontend);
  assert.equal(c.sections[0].entries[0].bullets[0].text, "Made React pages faster with CSS fixes.");
});

test("picks the matching summary, title and project", () => {
  const c = choose(bank, frontend);
  assert.equal(c.summary, "Frontend person: React and CSS.");
  assert.equal(c.title, "Frontend Engineer");
  assert.deepEqual(c.sections[1].entries.map(e => e.entry.title), ["ui-thing"]);
});

test("moves matched skills to the front of a skills line", () => {
  const c = choose(bank, { required: ["TypeScript"], nice: [], keywords: [], title: "" });
  assert.deepEqual(c.sections[2].skills![0].items, ["TypeScript", "Python", "SQL"]);
});

test("dropOne removes the weakest unpinned bullet and respects min", () => {
  const c = choose(bank, frontend);
  assert.equal(dropOne(c, bank), "Made React pages faster with CSS fixes.");
  // only the pinned bullet is left at min 1, so the picked project goes next
  assert.equal(dropOne(c, bank), "ui-thing");
  assert.equal(dropOne(c, bank), null);
});

test("pickTitle prefers the closest headline", () => {
  assert.equal(pickTitle(["Full-Stack Software Engineer", "Frontend Engineer", "Software Engineer"], "Software Engineer, New Grad"), "Software Engineer");
  assert.equal(pickTitle(["Full-Stack Software Engineer", "Software Engineer"], "Full Stack Engineer"), "Full-Stack Software Engineer");
});

test("inline formatting escapes HTML and keeps bold and links", () => {
  assert.equal(inline("**Lead:** a <b> [site](https://x.dev)"), '<b class="lead">Lead:</b> a &lt;b&gt; <a href="https://x.dev">site</a>');
});

test("toText is plain text", () => {
  assert.ok(!toText(choose(bank, frontend)).includes("**"));
});

test("countPages counts page objects, not the page tree", () => {
  assert.equal(countPages(Buffer.from("<< /Type /Pages /Kids [] >> << /Type /Page >> << /Type /Page\n>>")), 2);
});
