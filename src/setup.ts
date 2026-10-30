#!/usr/bin/env node
// npm run setup: asks a few questions and writes config.local.json.

import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";
import { ROOT, listProfiles } from "./skills.ts";

// Read answers line by line (works when typed, pasted or piped).
const rl = createInterface({ input: stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(q: string, def = ""): Promise<string> {
  stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
  const r = await lines.next();
  if (r.done) { console.log("\nSetup cancelled."); process.exit(1); }
  return r.value.trim() || def;
}
const target = resolve(ROOT, "config.local.json");

console.log("job-radar setup. Press Enter to accept the value in [brackets].\n");
if (existsSync(target) && !/^y/i.test(await ask("config.local.json already exists. Replace it? (y/n)", "n"))) {
  console.log("Nothing changed.");
  process.exit(0);
}

const profiles = listProfiles().sort((a, b) => (a.name === "software" ? -1 : b.name === "software" ? 1 : a.name.localeCompare(b.name)));
console.log("Career profiles:");
profiles.forEach((p, i) => console.log(`  ${i + 1}. ${p.name.padEnd(10)} ${p.description}`));
let profile = "";
while (!profile) {
  const a = await ask("Pick a profile (number or name)", "1");
  profile = profiles[parseInt(a, 10) - 1]?.name ?? profiles.find(p => p.name === a)?.name ?? "";
  if (!profile) console.log("  Not one of the profiles above.");
}

let resume = "";
while (!resume) {
  const a = (await ask("Path to your resume (.pdf, .txt or .md). Tip: drag the file into this window", "./resume.pdf")).replace(/^['"]|['"]$/g, "").replace(/\\ /g, " ");
  if (existsSync(resolve(ROOT, a))) resume = a;
  else if (/^y/i.test(await ask(`  ${a} doesn't exist yet. Use it anyway and add the file later? (y/n)`, "n"))) resume = a;
}

const remoteUS = /^y/i.test(await ask("Include remote jobs in the US? (y/n)", "y"));
const cities = (await ask("Cities you'd work in, comma-separated (blank = remote only)", ""))
  .split(",").map(c => c.trim().toLowerCase()).filter(Boolean);
const label = cities.length ? await ask("A short name for that city list, shown in reports", "Local") : "Local";
const defaults = JSON.parse(readFileSync(resolve(ROOT, "profiles", profile, "profile.json"), "utf8")).defaults ?? {};
const maxYears = parseInt(await ask("Most years of experience a job may ask for", String(defaults.maxYears ?? 2)), 10);
const graduation = await ask("Graduation month as YYYY-MM, if new-grad windows matter to you (blank = skip)", "");
const lang = (await ask("Report language: en or zh", "en")) === "zh" ? "zh" : "en";
rl.close();

const cfg: Record<string, unknown> = {
  _note: `Your settings. Rules not listed here come from profiles/${profile}/profile.json; copy a key here to override it.`,
  profile, resume,
  ...(graduation ? { graduation } : {}),
  maxYears,
  locations: { remoteUS, cities, label },
  minScore: 35, keepDays: 7, dump: false, dumpKeepDays: 30, lang,
};
writeFileSync(target, JSON.stringify(cfg, null, 2) + "\n");
console.log(`\nSaved ${target}\n\nNext:\n  npm run skills   check which skills were found in your resume\n  npm run scan     fetch jobs and write the report\n  npm run open     open the report`);
