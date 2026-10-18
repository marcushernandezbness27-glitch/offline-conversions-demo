/**
 * Offline Conversions CRM (Google Sheets + Apps Script)
 *
 * 1. doPost: receives leads from marcushq.buzz/api/lab/lead (shared-secret checked)
 *    and appends them to the "Leads" sheet.
 * 2. onEdit: when a lead's Stage changes to Appointment or Sale, stamps the time.
 * 3. Menu "Offline conversions":
 *    - Build upload files: creates
 *        a) a Google Ads click-conversion import (GCLID rows), and
 *        b) an enhanced-conversions-for-leads import (SHA-256 hashed email/phone)
 *      plus a Validation sheet explaining every skipped row.
 *    - Mark last build as uploaded: stamps uploaded_* so nothing is sent twice.
 *
 * Setup: Extensions → Apps Script, paste this file, set the script property
 * SHARED_TOKEN (Project Settings → Script properties), run setup() once,
 * then Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 */

var LEADS = "Leads";
var HEADERS = [
  "lead_id", "created_at", "first_name", "email", "phone", "interest",
  "gclid", "gbraid", "wbraid", "click_ts", "utm_source", "utm_medium", "utm_campaign",
  "landing_page", "id_source", "consent_ad_user_data",
  "stage", "appointment_at", "sale_at", "sale_value", "currency",
  "uploaded_appointment_at", "uploaded_sale_at", "notes"
];
var STAGES = ["Lead", "Appointment", "Sale", "Lost"];
var CONVERSIONS = {
  Appointment: { name: "Offline - Appointment booked", timeCol: "appointment_at", upCol: "uploaded_appointment_at", value: 0 },
  Sale: { name: "Offline - Sale", timeCol: "sale_at", upCol: "uploaded_sale_at", value: null } // value from sale_value
};
var CLICK_MAX_AGE_DAYS = 90; // conversion windows max out at 90 days; older clicks won't attribute
var CURRENCY = "USD";

// ---------- setup ----------
function setup() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(LEADS) || ss.insertSheet(LEADS);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
  sh.setFrozenRows(1);
  var stageCol = HEADERS.indexOf("stage") + 1;
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STAGES, true).setAllowInvalid(false).build();
  sh.getRange(2, stageCol, 1000, 1).setDataValidation(rule);
  if (!PropertiesService.getScriptProperties().getProperty("SHARED_TOKEN")) {
    throw new Error("Set the script property SHARED_TOKEN before deploying (Project Settings → Script properties).");
  }
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Offline conversions")
    .addItem("Build upload files", "buildUploadFiles")
    .addItem("Mark last build as uploaded", "markLastBuildUploaded")
    .addToUi();
}

// ---------- 1. intake ----------
function doPost(e) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    var body = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty("SHARED_TOKEN");
    if (!token || body.token !== token) return out({ ok: false, error: "unauthorized" });
    var lead = body.lead || {};
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sh = SpreadsheetApp.getActive().getSheetByName(LEADS);
      var row = HEADERS.map(function (h) {
        if (h === "stage") return "Lead";
        if (h === "currency") return CURRENCY;
        // Prefix with ' so Sheets keeps IDs/phones as text (no number or date coercion).
        var v = lead[h] == null ? "" : String(lead[h]);
        return /^(gclid|gbraid|wbraid|phone|lead_id)$/.test(h) && v ? "'" + v : v;
      });
      sh.appendRow(row);
    } finally { lock.releaseLock(); }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 200) });
  }
}

// ---------- 2. stage timestamps ----------
function onEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== LEADS || e.range.getRow() < 2) return;
  if (e.range.getColumn() !== HEADERS.indexOf("stage") + 1) return;
  var conv = CONVERSIONS[e.value];
  if (!conv) return;
  var cell = sh.getRange(e.range.getRow(), HEADERS.indexOf(conv.timeCol) + 1);
  if (!cell.getValue()) cell.setValue(new Date()); // first time only: re-selecting a stage doesn't move the date
}

// ---------- 3. upload files ----------
function buildUploadFiles() {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var data = ss.getSheetByName(LEADS).getDataRange().getValues();
  var H = {}; data[0].forEach(function (h, i) { H[h] = i; });
  var stamp = Utilities.formatDate(new Date(), tz, "yyyyMMdd_HHmm");
  var fmt = function (d) { return Utilities.formatDate(new Date(d), tz, "yyyy-MM-dd HH:mm:ss"); };

  var clickRows = [], ecRows = [], log = [], built = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r], id = row[H.lead_id];
    for (var stage in CONVERSIONS) {
      var conv = CONVERSIONS[stage], when = row[H[conv.timeCol]];
      if (!when) continue;                                   // stage not reached
      if (row[H[conv.upCol]]) { log.push([id, conv.name, "skip", "already uploaded"]); continue; }
      var value = conv.value === null ? Number(row[H.sale_value]) : conv.value;
      if (stage === "Sale" && !(value > 0)) { log.push([id, conv.name, "skip", "Sale has no sale_value: add the amount, then rebuild"]); continue; }
      var consent = row[H.consent_ad_user_data] === "Granted" ? "Granted" : "Denied";
      var gclid = String(row[H.gclid] || ""), clickTs = row[H.click_ts] ? new Date(row[H.click_ts]) : null;

      if (gclid) {
        if (clickTs && new Date(when) < clickTs) { log.push([id, conv.name, "skip", "conversion time is before the click time"]); continue; }
        if (clickTs && (new Date(when) - clickTs) / 864e5 > CLICK_MAX_AGE_DAYS) { log.push([id, conv.name, "skip", "click older than " + CLICK_MAX_AGE_DAYS + " days: won't attribute"]); continue; }
        clickRows.push([gclid, conv.name, fmt(when), id + "-" + stage, value, CURRENCY, consent, consent]);
        log.push([id, conv.name, "click file", "GCLID row; consent " + consent]);
      }
      // Enhanced conversions for leads (hashed identifiers) only for conversions WITHOUT a
      // GCLID: gbraid/wbraid-only (iOS) clicks and clicks with no ID. The two files are
      // mutually exclusive, so the same Order ID is never imported twice.
      if (!gclid) {
        var em = hashEmail(row[H.email]), ph = hashPhone(row[H.phone]);
        if (!em && !ph) { log.push([id, conv.name, "skip", "no click ID and no email/phone: cannot be attributed"]); continue; }
        ecRows.push([em, ph, conv.name, fmt(when), id + "-" + stage, value, CURRENCY, consent]);
        log.push([id, conv.name, "EC file", (row[H.gbraid] || row[H.wbraid] ? "gbraid/wbraid only: not accepted in the click file, matched by hashed email" : "no click ID: matched by hashed email") + "; consent " + consent]);
      }
      built.push([r + 1, conv.upCol]);
    }
  }

  write(ss, "upload_clicks_" + stamp, ["Parameters:TimeZone=" + tz],
    ["Google Click ID", "Conversion Name", "Conversion Time", "Order ID", "Conversion Value", "Conversion Currency", "Ad User Data", "Ad Personalization"], clickRows);
  write(ss, "upload_ec_leads_" + stamp, ["Parameters:TimeZone=" + tz],
    ["Email", "Phone Number", "Conversion Name", "Conversion Time", "Order ID", "Conversion Value", "Conversion Currency", "Ad User Data"], ecRows);
  write(ss, "validation_" + stamp, null, ["lead_id", "conversion", "result", "detail"], log);

  PropertiesService.getDocumentProperties().setProperty("LAST_BUILD", JSON.stringify({ stamp: stamp, rows: built }));
  SpreadsheetApp.getUi().alert("Built " + stamp + ": " + clickRows.length + " click rows, " + ecRows.length +
    " hashed rows. Review validation_" + stamp + ", download each upload_* sheet as CSV, import it in Google Ads, then run 'Mark last build as uploaded'.");
}

function markLastBuildUploaded() {
  var last = JSON.parse(PropertiesService.getDocumentProperties().getProperty("LAST_BUILD") || "null");
  if (!last) { SpreadsheetApp.getUi().alert("No build to mark."); return; }
  var sh = SpreadsheetApp.getActive().getSheetByName(LEADS), now = new Date();
  last.rows.forEach(function (x) { sh.getRange(x[0], HEADERS.indexOf(x[1]) + 1).setValue(now); });
  PropertiesService.getDocumentProperties().deleteProperty("LAST_BUILD");
  SpreadsheetApp.getUi().alert("Marked " + last.rows.length + " conversions from build " + last.stamp + " as uploaded.");
}

function write(ss, name, paramRow, header, rows) {
  var sh = ss.insertSheet(name), values = [];
  if (paramRow) values.push(pad(paramRow, header.length));
  values.push(header);
  rows.forEach(function (r) { values.push(r); });
  sh.getRange(1, 1, values.length, header.length).setNumberFormat("@").setValues(values);
}
function pad(arr, n) { var a = arr.slice(); while (a.length < n) a.push(""); return a; }

// ---------- hashing (Google's normalisation rules) ----------
// Email: trim + lowercase; for gmail.com / googlemail.com also drop dots and any +suffix
// in the local part. Phone: E.164 (+ country code). Then SHA-256, lowercase hex.
function hashEmail(v) {
  var e = String(v || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e)) return "";
  var p = e.split("@");
  if (p[1] === "gmail.com" || p[1] === "googlemail.com") p[0] = p[0].split("+")[0].replace(/\./g, "");
  return sha256(p[0] + "@" + p[1]);
}
function hashPhone(v) {
  var d = String(v || "").replace(/^'/, "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.charAt(0) !== "+") d = (d.length === 10 ? "+1" : "+") + d; // demo assumption: 10-digit numbers are US
  return /^\+\d{8,15}$/.test(d) ? sha256(d) : "";
}
function sha256(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}
