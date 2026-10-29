// Output language. "en" (default) or "zh". Set from config "lang" or the --lang flag.
export let lang: "en" | "zh" = "en";
export function setLang(l?: string) { lang = l === "zh" ? "zh" : "en"; }
// Pick the string for the current language: L("中文", "English").
export const L = (zh: string, en: string) => (lang === "zh" ? zh : en);
