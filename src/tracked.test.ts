import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, sheetJobs, sheetCsvUrl, makeLookup } from "./tracked.ts";

test("sheetCsvUrl turns an edit link into the CSV export of that tab", () => {
  assert.equal(sheetCsvUrl("https://docs.google.com/spreadsheets/d/abc-123/edit?gid=42#gid=42"),
    "https://docs.google.com/spreadsheets/d/abc-123/export?format=csv&gid=42");
  assert.equal(sheetCsvUrl("https://example.com/x.csv"), "https://example.com/x.csv");
});

test("parseCsv handles quotes, commas and newlines inside cells", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n'), [["a", "b"], ["x, y", 'say "hi"\nthere']]);
});

test("sheetJobs maps loose headers and normalizes dates and status", () => {
  const rows = parseCsv("Company,Role,Status,Applied,Follow-up,Link\nQuora,Full Stack,Applied,10/30/2026,11/6/2026,https://jobs.ashbyhq.com/quora/5494e6a1-a973-46af-b9f3-57208eb91b52\n,,,,,\n");
  const jobs = sheetJobs(rows);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], { company: "Quora", role: "Full Stack", url: "https://jobs.ashbyhq.com/quora/5494e6a1-a973-46af-b9f3-57208eb91b52", status: "applied", applied: "2026-10-30", followUp: "2026-11-06" });
  const t = makeLookup(jobs)({ url: "https://jobs.ashbyhq.com/quora/5494e6a1-a973-46af-b9f3-57208eb91b52?src=x", company: "Other", title: "x" } as any);
  assert.equal(t?.status, "applied");
});
