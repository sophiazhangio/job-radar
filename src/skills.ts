// Skill dictionary: name -> pattern that finds it in lowercase text.
// "core" skills count more toward the match score than "extra" ones.

export type Skill = { name: string; re: RegExp; core: boolean };

const s = (name: string, re: RegExp, core = true): Skill => ({ name, re, core });

export const SKILLS: Skill[] = [
  s("TypeScript", /\btypescript\b/),
  s("JavaScript", /\bjavascript\b|\bes6\b/),
  s("Python", /\bpython\b/),
  s("Java", /\bjava\b(?!script)/),
  s("SQL", /\bsql\b|\bpostgres|\bmysql\b/),
  s("Postgres", /\bpostgres(ql)?\b/),
  s("React", /\breact(\.js|js)?\b(?! native)/),
  s("Next.js", /\bnext\.?js\b/),
  s("Node.js", /\bnode(\.js|js)?\b/),
  s("HTML/CSS", /\bhtml\b|\bcss\b/),
  s("REST APIs", /\brest(ful)?\b|\bapis?\b/),
  s("Bash", /\bbash\b|\bshell script/, false),
  s("Git", /\bgit\b|\bgithub\b/, false),
  s("Supabase", /\bsupabase\b/, false),
  s("Vercel", /\bvercel\b/, false),
  s("Tailwind", /\btailwind/, false),
  s("GraphQL", /\bgraphql\b/, false),
  s("tRPC", /\btrpc\b/, false),
  s("Prisma/Drizzle", /\bprisma\b|\bdrizzle\b/, false),
  s("Express", /\bexpress(\.js|js)?\b/, false),
  s("Django", /\bdjango\b/, false),
  s("Flask/FastAPI", /\bflask\b|\bfastapi\b/, false),
  s("Docker", /\bdocker\b/, false),
  s("Kubernetes", /\bkubernetes\b|\bk8s\b/, false),
  s("AWS", /\baws\b|amazon web services/, false),
  s("GCP", /\bgcp\b|google cloud/, false),
  s("Azure", /\bazure\b/, false),
  s("Redis", /\bredis\b/, false),
  s("MongoDB", /\bmongo(db)?\b/, false),
  s("Firebase", /\bfirebase\b/, false),
  s("Testing", /\bjest\b|\bplaywright\b|\bcypress\b|\bvitest\b|\bpytest\b|unit tests?|end-to-end tests?|\be2e\b/, false),
  s("CI/CD", /\bci\/cd\b|\bci\b pipeline|github actions|continuous integration/, false),
  s("LLMs", /\bllms?\b|large language model|\bgpt\b|\bopenai\b|\banthropic\b|\bclaude\b/, false),
  s("AI agents", /\bagent(s|ic)?\b/, false),
  s("RAG / embeddings", /\brag\b|retrieval.augmented|embeddings?|vector (db|database|search)/, false),
  s("Claude Code / Codex / Cursor", /claude code|\bcodex\b|\bcursor\b|copilot|ai.(assisted|native) (coding|development|engineering)|ai coding/, false),
  // Skills the candidate usually lacks; they show up as gaps.
  s("Go", /\bgolang\b|\bgo\b(?=[,/)]| and | or )/, false),
  s("Rust", /\brust\b/, false),
  s("Kotlin", /\bkotlin\b/, false),
  s("Swift/iOS", /\bswift\b|\bios\b/, false),
  s("Android", /\bandroid\b/, false),
  s("React Native", /react native/, false),
  s("C#/.NET", /\bc#|\.net\b/, false),
  s("C/C++", /\bc\+\+|\bc\/c\+\+/, false),
  s("Ruby/Rails", /\bruby\b|\brails\b/, false),
  s("PHP", /\bphp\b/, false),
  s("Scala", /\bscala\b/, false),
  s("Spark/Kafka", /\bspark\b|\bkafka\b|\bflink\b/, false),
  s("Electron", /\belectron\b/, false),
  s("ML / PyTorch", /\bpytorch\b|\btensorflow\b|machine learning|\bml\b/, false),
];

export function findSkills(text: string): Set<string> {
  const t = text.toLowerCase();
  return new Set(SKILLS.filter(k => k.re.test(t)).map(k => k.name));
}

export const CORE = new Set(SKILLS.filter(k => k.core).map(k => k.name));
