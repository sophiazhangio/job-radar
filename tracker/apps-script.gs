// job-radar → Google Sheet receiver.
// Paste this into your sheet (Extensions → Apps Script), set TOKEN to any long random text,
// then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
// Put the web app URL in config.local.json as "trackerWebhook" and the same TOKEN as "trackerToken".
// `npm run applied -- <posting>` then adds a row under the header (newest first),
// or updates the status of a row whose Link already matches.

const TOKEN = "change-me";

function doPost(e) {
  const body = JSON.parse(e.postData.contents || "{}");
  if (body.token !== TOKEN) return out({ ok: false, error: "bad token" });
  const sh = SpreadsheetApp.getActive().getSheets()[0];
  const width = sh.getLastColumn();
  const top = sh.getRange(1, 1, Math.min(5, sh.getMaxRows()), width).getValues();
  const h = top.findIndex(r => r.some(c => /^company$/i.test(String(c).trim()))) + 1;
  if (!h) return out({ ok: false, error: "no Company header in the first 5 rows" });
  const head = top[h - 1].map(c => String(c).trim().toLowerCase());
  const col = name => head.indexOf(name.toLowerCase());
  const row = body.row || {};
  const n = Math.max(0, sh.getLastRow() - h);

  // Same link already tracked: only update its status (and date if empty).
  const lc = col("link");
  if (n && lc >= 0 && row.Link) {
    const links = sh.getRange(h + 1, lc + 1, n, 1).getValues();
    const i = links.findIndex(l => String(l[0]).trim() === row.Link);
    if (i >= 0) {
      const r = h + 1 + i;
      if (col("status") >= 0 && row.Status) sh.getRange(r, col("status") + 1).setValue(row.Status);
      const ac = col("applied");
      if (ac >= 0 && row.Applied && !sh.getRange(r, ac + 1).getValue()) sh.getRange(r, ac + 1).setValue(toDate(row.Applied));
      return out({ ok: true, updated: r });
    }
  }

  if (n) sh.insertRowBefore(h + 1); else sh.insertRowAfter(h);
  const r = h + 1;
  for (const [k, v] of Object.entries(row)) {
    const c = col(k);
    if (c < 0 || v === "" || v == null) continue;
    sh.getRange(r, c + 1).setValue(k === "Applied" ? toDate(v) : v);
  }
  const dc = col("days"), ac = col("applied"), sc = col("status");
  if (dc >= 0 && ac >= 0 && sc >= 0) {
    const A = letter(ac + 1) + r, S = letter(sc + 1) + r;
    sh.getRange(r, dc + 1).setFormula(`=IF(${A}="","",IF(AND(${S}="applied",TODAY()-${A}>90),"no reply 90d+",TEXT(TODAY()-${A},"0")&" days"))`);
  }
  return out({ ok: true, added: r });
}

function toDate(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); }
function letter(n) { let s = ""; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
