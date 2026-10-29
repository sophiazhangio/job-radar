import { readFile } from "node:fs/promises";

// Read the resume as plain text. Accepts .pdf, .txt or .md.
export async function readResume(path: string): Promise<string> {
  const buf = await readFile(path);
  if (!path.toLowerCase().endsWith(".pdf")) return buf.toString("utf8");
  const warn = console.warn, log = console.log;
  console.warn = console.log = () => {}; // pdf.js prints a harmless "use legacy build" warning
  try {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } finally { console.warn = warn; console.log = log; }
}
