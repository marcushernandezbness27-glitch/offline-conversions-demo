# Offline Conversion Import + Full-Funnel Attribution (Build 45)

Click-ID capture → Sheet CRM → Google Ads offline-conversion upload files, built on a live site with consent
mode v2. All leads are test data.

```
Ad click (?gclid | gbraid | wbraid + UTMs)
  └─► marcushq.buzz/lab/offline-conversions   (noindexed lab page, consent-aware capture)
        └─► POST /api/lab/lead   (Cloudflare Worker: validate, honeypot, hold the shared secret)
              └─► Apps Script web app   (token check) ─► Google Sheet "Leads"
                    stage: Lead → Appointment → Sale   (onEdit stamps times)
                    menu "Offline conversions" → Build upload files:
                       upload_clicks_*    GCLID rows, Google's legacy import format
                       upload_ec_leads_*  SHA-256 email/phone (gbraid/wbraid-only + no-ID leads)
                       validation_*       every decision and skip, with a reason
                    → Mark last build as uploaded (idempotent)
  GTM (Preview only): Google Ads conversion tag on lab_lead_submit, consent-gated, Conversion Linker scoped to the lab
```

| Path | What |
|---|---|
| `apps-script/Code.gs` | Sheet CRM: intake, stage stamps, upload-file builder, Google-normalised hashing |
| `test/harness.mjs` | Runs the real `Code.gs` in Node with Apps Script stand-ins: 25 checks |
| `TEST_RESULTS.md` | Live end-to-end results: browser consent scenarios, Sheet builds, GTM |
| `ATTRIBUTION_GAPS.md` | Where offline attribution leaks, and what this build does about each leak |
| `BIDDING_FRAMEWORK.md` | Conversion ladder, starved-campaign check, values, conversion lag |
| `CASE_STUDY.md` | Write-up for marcushq.buzz |
| `screenshots/` | 15 pieces of evidence referenced from TEST_RESULTS.md |

Site code (lab page + endpoint) lives in the `portfolio-site` repo: `src/views/lab.tsx`, `src/index.tsx`.

## Setup (your own copy)
1. Create a Google Sheet, then open Extensions → Apps Script and paste `apps-script/Code.gs`.
2. Add the script property `SHARED_TOKEN` (a long random string), run `setup()`, and deploy it as a web app (Execute as Me, Access Anyone).
3. Point a form backend at the web app URL with `{ token, lead }`, keeping the token server-side (here: a Cloudflare Worker).
4. `node test/harness.mjs` re-runs the 25 checks after any change to `Code.gs`.

## Limits
No Google Ads account (one requires a payment method), so the files were not imported, and Google's tag didn't send
browser-side hashed user data (`em`) for a placeholder conversion ID. See `TEST_RESULTS.md` §4.
