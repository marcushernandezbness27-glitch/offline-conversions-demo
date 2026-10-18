# Attribution Gap Analysis: Where Offline Conversions Get Lost

For a business where the sale happens offline (an appointment, an in-home quote, a signed contract), Google
Ads only learns what you send back. This is the inventory of where that signal leaks, what this build does
about each leak, and what's left.

| # | Gap | Why it happens | What this build does | Residual risk |
|---|---|---|---|---|
| 1 | **Click ID never captured** | Form plugins drop URL parameters; the visitor browses a few pages before submitting; redirects strip the query string | Click IDs are captured on landing and stored first-party for 90 days (with consent), so a submit on a later page or visit still carries them (tested: Scenario A) | Redirect chains that strip parameters before the page loads: audit every ad final URL |
| 2 | **iOS / Safari clicks have no GCLID** | Apple's privacy changes: iOS traffic often arrives with **gbraid** (app→web) or **wbraid** (web→web) instead of gclid | All three IDs are captured. Google's legacy click-file import doesn't accept them, so those conversions go to the **hashed-email (enhanced conversions for leads) file** instead (Scenarios B and C) | Hashed matching needs a usable email or phone, and match rates are below 100% |
| 3 | **Consent denied** | Visitors decline ad storage and user data | Without consent: nothing stored, the click ID travels only with a same-page submit, user data stays out of the dataLayer, and uploads carry **`Ad User Data = Denied`** (Scenario B) | Denied rows are processed under Google's consent rules, so some modelled rather than observed attribution is expected. That's the cost of compliance, not a bug |
| 4 | **Click too old** | The sale closes long after the click; conversion windows top out at 90 days | Rows whose conversion falls more than 90 days after the click are skipped with a reason, rather than sent and silently ignored | Long sales cycles under-credit ads. See the bidding framework (optimise to an earlier stage) |
| 5 | **Cross-device journeys** | Clicked on a phone, called or emailed from a laptop | The hashed email/phone file gives Google a second match key independent of the click device | Phone-only or walk-in conversions with no shared identifier stay unmatched |
| 6 | **Conversion before click** | CRM time-zone errors; the wrong lead matched to a click | Validation skips rows where the conversion time is earlier than the click time; one time zone is written into every file | Upstream data-entry errors still need CRM hygiene |
| 7 | **Missing value** | A sale is logged without an amount, so value-based bidding learns $0 | A Sale with no value is **skipped and flagged**, not uploaded as $0 (Scenario: Cara) | Someone has to fill it in. The validation log is the queue |
| 8 | **Double counting** | The same conversion is uploaded twice, or once in each file | Order ID = `lead_id-stage`; the click and hashed files are mutually exclusive; "mark uploaded" makes rebuilds idempotent (tested) | Manual re-uploads of old exports: keep the uploaded_* columns intact |
| 9 | **Upload timing** | Google processes imports with a delay and recommends overlapping uploads | Documented runbook: upload daily, include the previous day's conversions, and wait 4–6 hours after creating a new conversion action before the first upload (Google's guidance) | Reports lag 24–48 hours behind reality |
| 10 | **The method itself is legacy** | Google labels file-based offline import "legacy" and points to Google Ads Data Manager plus enhanced conversions for leads | Both files follow the documented legacy format. The data model (click IDs, hashed identifiers, consent, Order IDs) maps directly onto the newer path | Re-validate the column format against the template downloaded from the live account before the first real import |

## What couldn't be tested without a Google Ads account

- **The actual import:** whether Google accepts each file, and its match rates. Files are built to Google's documented format; acceptance is unverified.
- **Browser-side enhanced conversions** (the `em` parameter): Google's tag withholds hashed user data for a conversion ID with no account behind it. Server-side hashing is proven by the offline file.
