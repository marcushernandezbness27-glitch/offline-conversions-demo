# Bidding Strategy Framework for Offline-Converting Businesses

Smart Bidding optimises toward whatever conversion signal it's given, as often as it's given. A home-services
business that only uploads the final *sale* gives it a signal that is rare, slow and high-variance. That's
the "starved campaign" problem. This framework decides **what to optimise toward, and when to move up the
ladder.** Thresholds below are planning defaults to agree with the client, not Google-guaranteed numbers.

## 1. The conversion ladder

| Rung | Event | Source | Typical role | Value to assign |
|---|---|---|---|---|
| 1 | Form lead (`lab_lead_submit`) | Browser tag | **Secondary** (observe only) once deeper rungs have volume | None, or a small nominal value |
| 2 | **Appointment booked** | Offline upload | **Primary** while sales volume is low | Expected value = appointment→sale rate × average sale |
| 3 | **Sale** | Offline upload, with the actual amount | **Primary** once volume supports value-based bidding | Actual sale value |

Mark only the rung you're bidding on as **primary**. Every other action stays **secondary**, so it's reported but
doesn't steer bids. Having both "lead" and "sale" primary double-optimises toward cheap leads.

## 2. Choosing the rung: the starved-campaign check

Count each rung's conversions over the last 30 days, per campaign or portfolio bid strategy:

```
Sales volume enough for value bidding (planning default ~30+/30d)?
   └── yes → bid on Sale value (Maximize conversion value / tROAS)
   └── no  → Appointments enough (~30+/30d)?
              └── yes → bid on Appointment with an expected value (Max conv. value / tROAS on proxy value)
              └── no  → bid on Lead (Maximize conversions / tCPA), and
                        pool campaigns into a portfolio strategy to combine volume
```

Re-check monthly. Moving up a rung is a deliberate change. Expect a learning period after switching the
primary action, and don't judge it in the first 1–2 weeks.

## 3. Values: the part most accounts get wrong

- **Proxy values must be honest.** Appointment value = (appointment→sale rate) × (average sale), computed from
  the CRM over a trailing period. Re-calculate quarterly. An inflated proxy teaches the bidder to overpay.
- **Never upload $0 sales.** A Sale with no value teaches value-based bidding that the click was worthless.
  The upload script skips and flags these rows instead (see `TEST_RESULTS.md`, Cara).
- **Use one currency per conversion action**, and the same time zone in every file.

## 4. Reporting with conversion lag

Offline conversions arrive days or weeks after the click, so the last 1–3 weeks always under-report. Before
judging a campaign:
- Compare periods **by conversion time and by click time** separately in Google Ads.
- Exclude the most recent window that's still filling from any CPA or ROAS decision.
- Watch the upload validation log for systematic skips (missing values, old clicks): they are lost signal.

## 5. Health checks

| Check | Signal of trouble |
|---|---|
| Share of leads with any click ID (gclid/gbraid/wbraid) | Falling: a form or redirect is dropping parameters |
| Share routed to the hashed (EC) file | Rising: more iOS / consent-denied traffic, so watch match rates |
| Validation skips per upload | Rising "no sale_value": a CRM process gap |
| Days from click to sale (median) | Approaching 90: move the primary action down the ladder |
