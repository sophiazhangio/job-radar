import { test } from "node:test";
import assert from "node:assert/strict";
import { levelRules } from "./levels.ts";

const defaults = { excludeTitle: ["senior", "sr ", "staff", "lead", "manager", "intern", "mid-level", "sales"], maxYears: 2 };

test("entry keeps the profile's rules", () => {
  assert.deepEqual(levelRules(defaults, "entry"), {});
  assert.deepEqual(levelRules(defaults, undefined), {});
});

test("mid lets mid-level titles back in and drops new-grad ones", () => {
  const r = levelRules(defaults, "mid") as any;
  assert.ok(!r.excludeTitle.includes("mid-level"));
  assert.ok(r.excludeTitle.includes("senior") && r.excludeTitle.includes("new grad"));
  assert.equal(r.maxYears, 5);
  assert.equal(r.requireLevel, false);
});

test("senior lets senior titles back in but still drops managers and interns", () => {
  const r = levelRules(defaults, "senior") as any;
  for (const w of ["senior", "sr ", "staff", "lead"]) assert.ok(!r.excludeTitle.includes(w), w);
  for (const w of ["manager", "intern", "sales", "junior", "new grad"]) assert.ok(r.excludeTitle.includes(w), w);
});
