import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl } from "./sources.ts";

test("the same posting's links all normalize to one", () => {
  const raydar = "https://apply.workable.com/raydar/j/EF9BC1EC32";
  for (const u of [raydar + "/apply", raydar + "/", raydar + "/apply?src=Linkedin", raydar + "#top"]) assert.equal(canonicalUrl(u), raydar);
  assert.equal(canonicalUrl("https://https://careers.example.com/jobs/1?lang=en-us&iis=Job+Board"), "https://careers.example.com/jobs/1");
  assert.equal(canonicalUrl("https://jobs.ashbyhq.com/runpod/abc?utm_source=x"), "https://jobs.ashbyhq.com/runpod/abc");
  // Parameters that identify the posting stay.
  assert.equal(canonicalUrl("https://www.storable.com/careers/?gh_jid=6230578004"), "https://www.storable.com/careers?gh_jid=6230578004");
});
