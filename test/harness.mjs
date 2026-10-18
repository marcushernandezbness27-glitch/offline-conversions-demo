// Runs the real apps-script/Code.gs in Node with minimal stand-ins for the Google
// Apps Script services, so intake, validation, file building and hashing can be
// tested before the script is pasted into a Sheet.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "apps-script", "Code.gs"), "utf8");

// ---- stand-ins --------------------------------------------------------------
function makeSheet(name) {
  const rows = [];
  const sheet = {
    name, rows,
    getName: () => name,
    appendRow: (r) => rows.push(r.map((v) => (typeof v === "string" && v.startsWith("'") ? v.slice(1) : v))),
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    getRange: (r, c) => {
      const rng = {
        setValues: (vals) => { vals.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }); return rng; },
        setValue: (v) => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; return rng; },
        getValue: () => (rows[r - 1] || [])[c - 1],
        setNumberFormat: () => rng, setFontWeight: () => rng, setDataValidation: () => rng,
      };
      return rng;
    },
    setFrozenRows() {},
  };
  return sheet;
}
const sheets = {};
const ss = {
  getSheetByName: (n) => sheets[n] || null,
  insertSheet: (n) => (sheets[n] = makeSheet(n)),
  getSpreadsheetTimeZone: () => "America/New_York",
};
const props = { SHARED_TOKEN: "test-token" }, docProps = {};
let lastAlert = "";
const ctx = {
  SpreadsheetApp: { getActive: () => ss, getUi: () => ({ alert: (m) => (lastAlert = m), createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }),
    newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } }) },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }),
    getDocumentProperties: () => ({ getProperty: (k) => docProps[k] ?? null, setProperty: (k, v) => (docProps[k] = v), deleteProperty: (k) => delete docProps[k] }),
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
  Utilities: {
    DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
    computeDigest: (_a, s) => [...createHash("sha256").update(s, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)), // Apps Script returns signed bytes
    formatDate: (d, _tz, _f) => new Date(d).toISOString().replace("T", " ").slice(0, 19),
  },
  console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

let fails = 0;
const check = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`); if (!cond) fails++; };
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ---- 1. hashing: Google's documented normalisation example ---------------------
check("gmail-family normalisation (Google's example)", ctx.hashEmail(" Jane.Doe+Shopping@googlemail.com ") === sha("janedoe@googlemail.com"));
check("non-gmail keeps dots and +tags", ctx.hashEmail("Jane.Doe+x@Example.com") === sha("jane.doe+x@example.com"));
check("invalid email hashes to empty", ctx.hashEmail("not-an-email") === "");
check("10-digit phone → +1 E.164", ctx.hashPhone("(555) 010-0001") === sha("+15550100001"));
check("E.164 phone kept", ctx.hashPhone("+44 20 7946 0958") === sha("+442079460958"));
check("hash is 64 lowercase hex", /^[0-9a-f]{64}$/.test(ctx.hashEmail("a@b.co")));

// ---- 2. intake --------------------------------------------------------------
ctx.setup();
const post = (lead, token = "test-token") => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ token, lead }) } }).s);
check("wrong token rejected", post({ lead_id: "X" }, "nope").ok === false);
const H = ctx.HEADERS;
const base = { created_at: "2026-10-01T15:00:00.000Z", first_name: "T", interest: "Kitchen remodel", consent_ad_user_data: "Granted" };
const leads = [
  { ...base, lead_id: "L-GCLID", email: "a@example.com", gclid: "TeSt-GCLID-1", click_ts: "2026-10-01T14:00:00.000Z", id_source: "url" },
  { ...base, lead_id: "L-GBRAID", email: "Jane.Doe+x@gmail.com", gbraid: "TeSt-GBRAID-1", click_ts: "2026-10-01T14:00:00.000Z", id_source: "url" },
  { ...base, lead_id: "L-NOID", email: "c@example.com", phone: "5550100003", id_source: "none", consent_ad_user_data: "Denied" },
  { ...base, lead_id: "L-NOSALEVALUE", email: "d@example.com", gclid: "TeSt-GCLID-4", click_ts: "2026-10-01T14:00:00.000Z" },
  { ...base, lead_id: "L-BEFORECLICK", email: "e@example.com", gclid: "TeSt-GCLID-5", click_ts: "2026-10-05T14:00:00.000Z" },
  { ...base, lead_id: "L-OLDCLICK", email: "f@example.com", gclid: "TeSt-GCLID-6", click_ts: "2026-05-01T14:00:00.000Z" },
];
leads.forEach((l) => check(`intake ${l.lead_id}`, post(l).ok === true));
const sh = sheets.Leads;
check("gclid stored as text, not coerced", sh.rows[1][H.indexOf("gclid")] === "TeSt-GCLID-1");

// ---- 3. pipeline progress (what a rep would do in the sheet) -------------------------
const set = (id, col, v) => { const r = sh.rows.findIndex((x) => x[0] === id); sh.rows[r][H.indexOf(col)] = v; };
set("L-GCLID", "appointment_at", "2026-10-03T16:00:00.000Z"); set("L-GCLID", "sale_at", "2026-10-10T16:00:00.000Z"); set("L-GCLID", "sale_value", 18500);
set("L-GBRAID", "appointment_at", "2026-10-04T16:00:00.000Z");
set("L-NOID", "sale_at", "2026-10-08T16:00:00.000Z"); set("L-NOID", "sale_value", 9200);
set("L-NOSALEVALUE", "sale_at", "2026-10-09T16:00:00.000Z");
set("L-BEFORECLICK", "appointment_at", "2026-10-02T16:00:00.000Z");
set("L-OLDCLICK", "appointment_at", "2026-10-03T16:00:00.000Z");

ctx.buildUploadFiles();
const find = (p) => Object.values(sheets).find((s) => s.name.startsWith(p));
const clicks = find("upload_clicks_"), ec = find("upload_ec_leads_"), val = find("validation_");
check("click file: TimeZone parameter row", clicks.rows[0][0] === "Parameters:TimeZone=America/New_York");
check("click file: Google's header order", clicks.rows[1].join("|") === "Google Click ID|Conversion Name|Conversion Time|Order ID|Conversion Value|Conversion Currency|Ad User Data|Ad Personalization");
const clickIds = clicks.rows.slice(2).map((r) => r[3]);
check("click file rows = GCLID appointment + GCLID sale only", clickIds.join(",") === "L-GCLID-Appointment,L-GCLID-Sale", clickIds.join(","));
check("sale value carried", clicks.rows.slice(2).find((r) => r[3] === "L-GCLID-Sale")[4] === 18500);
const ecIds = ec.rows.slice(2).map((r) => r[4]);
check("EC file = gbraid-only + no-ID leads (no GCLID leads)", ecIds.join(",") === "L-GBRAID-Appointment,L-NOID-Sale", ecIds.join(","));
check("EC hashes gmail-normalised email", ec.rows.slice(2)[0][0] === sha("janedoe@gmail.com"));
check("EC carries Denied consent where given", ec.rows.slice(2).find((r) => r[4] === "L-NOID-Sale")[7] === "Denied");
const reason = (id) => val.rows.slice(1).filter((r) => r[0] === id).map((r) => r[3]).join(" | ");
check("skip: sale without value", /no sale_value/.test(reason("L-NOSALEVALUE")), reason("L-NOSALEVALUE"));
check("skip: conversion before click", /before the click/.test(reason("L-BEFORECLICK")), reason("L-BEFORECLICK"));
check("skip: click older than 90 days", /older than 90/.test(reason("L-OLDCLICK")), reason("L-OLDCLICK"));

// ---- 4. idempotency -------------------------------------------------------------
ctx.markLastBuildUploaded();
ctx.buildUploadFiles();
const clicks2 = Object.values(sheets).filter((s) => s.name.startsWith("upload_clicks_")).pop();
const ec2 = Object.values(sheets).filter((s) => s.name.startsWith("upload_ec_leads_")).pop();
check("rebuild after 'mark uploaded' sends nothing twice", clicks2.rows.length === 2 && ec2.rows.length === 2, `${clicks2.rows.length - 2} click rows, ${ec2.rows.length - 2} EC rows`);

console.log(fails ? `\n${fails} FAILED` : "\nall checks passed");
process.exit(fails ? 1 : 0);
