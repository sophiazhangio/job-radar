import { test } from "node:test";
import assert from "node:assert/strict";
import { SENIOR_TEXT } from "./score.ts";

test("senior duties are spotted", () => {
  for (const s of ["Raise the quality bar through technical leadership, reviews, mentoring", "You will mentor other engineers", "proven track record shipping", "set the technical direction for web"]) assert.ok(SENIOR_TEXT.test(s), s);
});

test("junior support and perks are not senior", () => {
  for (const s of ["You'll receive mentoring from senior engineers", "mentorship and coaching opportunities", "work closely with senior engineers", "lead small features end to end"]) assert.ok(!SENIOR_TEXT.test(s), s);
});

test("pay floor reads the lowest USD amount", async () => {
  const { payFloor } = await import("./score.ts");
  assert.equal(payFloor("$196,000-$294,000"), 196000);
  assert.equal(payFloor("$150K–$270K"), 150000);
  assert.equal(payFloor("CA$180K – CA$250K"), 0);
  assert.equal(payFloor(""), 0);
});
