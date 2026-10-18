# Test Results: Offline Conversion Pipeline

Run 2026-10-17/18 on the live stack: `marcushq.buzz/lab/offline-conversions` (noindexed), the
Cloudflare Worker endpoint `/api/lab/lead`, Apps Script web app, and the Google Sheet CRM. All leads are test
data. Screenshots are in `screenshots/`.

## 1. Apps Script, offline harness (`test/harness.mjs`): 25/25 pass

The real `Code.gs` was run in Node with stand-ins for the Apps Script services, before it was pasted into a Sheet.

| Area | Checks |
|---|---|
| Hashing | Google's normalisation example (`Jane.Doe+Shopping@googlemail.com` → `janedoe@googlemail.com`); non-Gmail addresses keep dots and +tags; phone → E.164; output is 64 lowercase hex |
| Intake | Wrong token rejected; click IDs stored as text (no number or date coercion) |
| Click file | `Parameters:TimeZone` row; Google's header order; GCLID conversions only; sale value carried |
| EC file | Only gbraid/wbraid-only and no-ID conversions; Gmail-normalised hash; Denied consent carried |
| Validation | Sale with no value, conversion before click, and click older than 90 days are each skipped, with the reason |
| Idempotency | Rebuild after "mark uploaded" → 0 rows |

## 2. Browser capture and consent (live site)

| # | Scenario | Result | Evidence |
|---|---|---|---|
| A | gclid click → **Allow** → navigate to a URL with no click ID | **Pass.** The gclid persisted ("first-party storage (earlier click)"), with the original click time kept. Lead submitted with gclid, `id_source = stored`, consent Granted | `01`, `02` |
| B | gbraid click → **Decline** → submit on the same page → navigate away | **Pass.** gbraid attached to the lead from page memory, consent **Denied**. After navigating: **nothing stored** (all fields empty) | `03`, `04` |
| C | wbraid click → Allow → submit | **Pass.** wbraid, Granted | Sheet row |
| D | Direct visit, no ad click → Allow → submit | **Pass.** No click ID, `id_source = none` | Sheet row |

## 3. Sheet CRM → upload files

Stages were set from the Sheet's dropdown. `onEdit` stamped `appointment_at` and `sale_at` automatically.

| Lead | Click ID | Consent | Stage set | Expected | Result |
|---|---|---|---|---|---|
| Pipeline (API test) | gclid | Granted | Appointment | click file | ✅ |
| Alice | gclid (stored) | Granted | Appointment → Sale $18,500 | 2 click-file rows | ✅ |
| Ben | gbraid | **Denied** | Appointment | EC file (gbraid isn't accepted in the click file), Denied | ✅ |
| Cara | wbraid | Granted | Sale, **no value** | skipped: "no sale_value" | ✅ |
| Dan | none | Granted | Sale $9,200 | EC file, email + phone hashes | ✅ |

**Hashes checked character by character against values computed independently:**
- Ben `ben.test.b@gmail.com` → `bentestb@gmail.com` → `88a97f81…` ✅
- Dan's phone `5550100004` → `+15550100004` → `a9fdd6ca…` ✅
- Dan's email was mistyped in the form as `dan.text.d@gmail.com`. The Sheet produced exactly `sha256("dantextd@gmail.com")` and *not* the hash of the raw address, so Gmail normalisation is confirmed on real input. ✅

Files: `06` (clicks: 3 rows), `07` (EC: 2 rows), `08` (validation). No Order ID appears in both files.

**Idempotency and correction:** "Mark last build as uploaded" stamped 5 conversions. Cara's `sale_value` was then
set to $12,400 and the files rebuilt:
- click file **empty**
- EC file **only Cara's sale**, with email and phone hashes, both verified
- validation shows 5 × "already uploaded"

Evidence: `09`, `10`, `11`.

## 4. GTM (Preview only, never published to the production container)

Workspace changes in GTM-TTFVC893:
- **Google Ads Conversion Tracking** tag (placeholder ID `000000000`, label `LAB_PLACEHOLDER`), fired by a custom event `lab_lead_submit`, requiring the `ad_storage` + `ad_user_data` consent checks
- **Conversion Linker** and the auto-created Google Ads tag, both scoped to the lab page only

| Check | Result | Evidence |
|---|---|---|
| Tag fires on a consented lead submit | ✅ "Succeeded"; a Conversion hit was sent | `12`, `13` |
| Click ID attached to the conversion | ✅ `gclaw=TeSt-GCLID-GTM-01` | `14` |
| Consent state sent with the hit | ✅ `gcs=G111` | `14` |
| Email enters the dataLayer only with consent | ✅ `user_data.email` present after Allow; the page code omits it when consent is declined | dataLayer dump |
| Hashed email (`em`) sent by Google's tag | ❌ **Not observable.** No `em` in any conversion request, with `user_data` set on the conversion tag (event parameter) or the Google tag (configuration parameter) | `15` |

**Why no `em`:** Google's tag only sends user-provided data when the Google Ads account behind the
conversion ID has enhanced conversions turned on and the customer-data terms accepted. A placeholder ID has
no account, so the tag holds the data back. That's the same wall as Build 9 (Google Ads requires a payment method
to open an account). The *matching* side (Google-normalised SHA-256 of email and phone) is proven by the offline EC
file above. Only the browser tag's own hashing remains unobserved.

**Configuration lessons from the GTM work:**
- "Enable Restricted Data Processing" is a US-privacy true/false flag, **not** where user data goes.
- A `user_data` configuration parameter on a Google tag that fires on page view is read **before** the form exists,
  so it's empty. User data belongs on the conversion tag that fires at submit.
- Adding an Ads conversion tag auto-creates a Google tag on **Initialization – All Pages**. On a production container,
  re-scope it before publishing, or a placeholder tag ships site-wide.
