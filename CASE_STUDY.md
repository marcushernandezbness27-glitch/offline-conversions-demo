# Offline Conversion Tracking for Google Ads: Click-ID Capture to Upload Files, iOS and Consent Included

> Target URL: marcushq.buzz/work/offline-conversion-import
> Built on a live site (marcushq.buzz, consent mode v2). All leads are test data.

**Role:** Sole builder (capture script, Worker endpoint, Sheet CRM and Apps Script, GTM, attribution and bidding docs)
**Stack:** Google Ads offline conversions · Enhanced conversions for leads · GTM · Consent mode v2 · Google Sheets + Apps Script · Cloudflare Workers

---

## The problem

When the sale happens offline (an in-home quote, an appointment, a signed contract), Google Ads only knows about
the form fill. It optimises toward cheap leads, not revenue. The standard fix is to capture the ad's click ID
with the lead and upload the later sale back to Google. In practice that breaks in predictable places:
- forms drop the click ID
- iOS traffic arrives without a GCLID at all
- consent rules limit what can be stored
- sales are logged without amounts
- the same conversion gets uploaded twice

This build implements the whole loop and tests each of those failure points on purpose.

## What was built

- **Consent-aware click-ID capture** on a live, noindexed lab page. It captures gclid, gbraid and wbraid plus UTMs. Click IDs are stored first-party for 90 days **only with ad consent**. Without consent they live in page memory and travel only with a same-page submit.
- **A Cloudflare Worker endpoint** that validates the lead, drops bots via a honeypot, and forwards to the CRM. The CRM's URL and shared secret never reach the browser.
- **A Google Sheet CRM with Apps Script:**
  - token-checked intake
  - a Lead → Appointment → Sale pipeline with automatic timestamps
  - one menu action that builds **two mutually exclusive upload files** plus a **validation log**
  - a "mark uploaded" step that makes rebuilds idempotent
- **Two upload files:**
  - GCLID conversions in Google's documented legacy import format (TimeZone row, `Ad User Data` / `Ad Personalization` consent columns)
  - everything without a GCLID (iOS gbraid/wbraid clicks and no-ID leads) as **SHA-256 hashed email/phone** for enhanced conversions for leads, using Google's normalisation rules
- **GTM** (Preview only, never published to the production container): a consent-gated Google Ads conversion tag, and a Conversion Linker scoped to the lab page.
- **An attribution gap analysis** (10 leak points) and a **bidding strategy framework** (conversion ladder, starved-campaign check, honest proxy values, conversion lag).

## Key decisions

### iOS clicks take the hashed path, not the click file
Google's legacy click import is built around the GCLID: GBRAID appears only in its external-attribution notes, and
WBRAID not at all. Instead of putting iOS identifiers into a file that may reject them, conversions with only a
gbraid/wbraid go to the enhanced-conversions-for-leads file and are matched on hashed email or phone. The CRM keeps
all three IDs for the Data Manager path Google now recommends.

### Two files that never overlap
A conversion with a GCLID goes in the click file only; everything else goes in the hashed file only. Both use
`Order ID = lead_id-stage`, so the same conversion can never be imported twice, either across the two files
or across rebuilds.

### Consent decides storage, and travels with the data
Declining consent doesn't silently lose the lead, and it doesn't store anything either. The click ID stays in page
memory, user data never enters the dataLayer, and the upload rows carry `Ad User Data = Denied`. Tested live: after
declining and navigating away, the capture table is empty.

### Skip and explain, never upload bad data
A sale with no amount would teach value-based bidding that the click was worthless. It's skipped and flagged. So is a
conversion timed before its click, and a click older than 90 days. Every decision lands in the validation log with
a reason, so the log doubles as the CRM's data-quality queue.

### Test the script before it touches a Sheet
The real Apps Script runs in Node against stand-ins for Google's services. 25 checks cover hashing (including
Google's own normalisation example), file formats, routing, validation and idempotency, all passing before the
first paste.

## Result

- **Harness:** 25/25 checks pass.
- **Live browser tests:** all 4 pass.
  - **A:** with consent, a gclid persists across navigation (stored first-party, 90-day expiry).
  - **B:** with consent declined, the gbraid is attached from page memory, marked Denied, and **nothing is stored**.
  - **C:** wbraid captured with consent.
  - **D:** direct visit, no click ID.
- **Sheet build:**
  - 3 GCLID conversions in the click file (including a $18,500 sale)
  - 2 conversions in the hashed file (Ben, gbraid with consent Denied; Dan, no click ID, $9,200)
  - 1 sale correctly skipped for a missing value
  - Every hash matched an independently computed value. A mistyped Gmail address (`dan.text.d@gmail.com`) produced exactly the hash of its normalised form (`dantextd@gmail.com`), confirming normalisation on real input.
- **Rebuild after "mark uploaded":** the click file was empty, and only the corrected sale ($12,400, wbraid → hashed file) was added.
- **GTM:** the conversion tag fired on a consented submit, carrying the click ID (`gclaw`) and consent state (`gcs=G111`).

## Honest gaps

- **No Google Ads account** (one requires a payment method), so the files were **not imported**. Acceptance and match rates are unverified. The format follows Google's documentation and should be re-checked against the template downloaded from a live account.
- **Browser-side enhanced conversions weren't observable.** Google's tag sent no hashed email (`em`) for a placeholder conversion ID, with user data configured on the conversion tag or the Google tag. It requires an account with enhanced conversions enabled. Server-side hashing is proven by the upload file.
- **File-based offline import is labelled legacy by Google,** which recommends Google Ads Data Manager. The data model maps onto it; the Data Manager path itself isn't built here.
- **Phone normalisation assumes US numbers** when no country code is given.
- **Test data only,** on a noindexed lab page.

---
*Companion files: `TEST_RESULTS.md`, `ATTRIBUTION_GAPS.md`, `BIDDING_FRAMEWORK.md`, `apps-script/Code.gs`, `test/harness.mjs`, `screenshots/`.*
