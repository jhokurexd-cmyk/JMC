# CLAUDE.md

Dental Clinic Management System — patient records, visits, procedures, treatment
plans / installment ledgers, and appointments for a solo-dentist clinic.

**Stack:** React + Vite (`client/`) · Node + Express + Prisma (`server/`) · PostgreSQL

## Non-negotiable rules

These are domain invariants, not style preferences. They keep the clinic's books
auditable and keep the system compliant with PH data-privacy law (RA 10173). Do
not weaken, work around, or "temporarily" bypass any of them. If a task seems to
require breaking one, stop and raise it with the user instead.

### 1. The ledger is append-only

- `LedgerEntry` rows are only ever **created**. There is deliberately no PATCH or
  DELETE route in `server/src/routes/ledger.js` — do not add one.
- Fix a wrong entry by writing a **correcting entry** (an offsetting `CHARGE`, a
  `DISCOUNT`, etc.), never by editing or deleting history.
- Entry types: `CHARGE`, `PAYMENT`, `DISCOUNT`.
- **Void / Refund = a linked reversal, not a delete.** `POST /ledger/:id/void`
  and `POST /ledger/:id/refund` (`reverseEntry` in `server/src/lib/ledger.js`)
  append a mirror row — same `type`/`amount`/`planId`/`appliesToId`,
  `reversalOfId` at the original, `reversalKind` = `'VOID'` | `'REFUND'`
  (refund also stores `refundMethod` and requires a reason). Balance/income
  effect is identical; the difference is the label and audit action (`VOID` /
  `REFUND`). Only a `PAYMENT`/`DISCOUNT`, once, never a reversal row.
  `activeEntries(entries)` (`server/src/lib/entries.js`) drops **both** the
  original and its reversal; **every** money calc runs through it first —
  `planTotals`, `computeDue`, `enrichEntries`, `paymentOverview`. `rangeSummary`
  (`server/src/lib/income.js`) is **retroactive**: a payment voided/refunded
  later drops out of its *original* day/week/month, so it returns
  `{ gross, refundsVoids, net }` and day/week/month always agree. `enrichEntries`
  tags every row `voided`/`isReversal` and every PAYMENT with `paymentStatus`
  (`PAID`/`VOIDED`/`REFUNDED`). Never compute money off raw `LedgerEntry` rows.
- **Receipts**: a real (non-reversal) PAYMENT gets a sequential `receiptNo`
  (`OR-000001`, `server/src/lib/receipts.js` + the `Counter` table) and a
  `balanceBefore`/`balanceAfter` Total-Due snapshot, set in the same tx. Printable
  at `/patients/:id/receipt/:entryId`. The patient tabs are **Overview · Visits ·
  Treatment/Braces plan · Ledger · Payments · X-rays · Patient info** — Ledger is
  charges/discounts + Mark-paid; **Payments** is the receipt list + void + refund.
- **Allocating to a charge**: a `PAYMENT`/`DISCOUNT` may carry `appliesToId`
  pointing at the one `CHARGE` it pays down (set once, never edited). Used for
  standalone charges — the target must be a `CHARGE` for the same patient with no
  `planId` (package charges are settled via the plan). `appliesToId` and `planId`
  are mutually exclusive. `server/src/lib/ledger.js` — `recordChargePayment`
  caps it at the charge's own remaining (`amount − Σ allocations`), `enrichEntries`
  derives each charge's `allocated` / `remaining` / `payStatus`, `openCharges`
  lists the still-unpaid standalone charges.

### 2. Balances are computed, never stored

- **Total Due** (`computeDue` / `patientDue` / `dueMap` in `server/src/lib/balance.js`,
  used by the patient list/detail, the ledger GET, and `reports/outstanding-balances`)
  = `sum(CHARGE − PAYMENT − DISCOUNT` for entries **not** tied to a package`)`
  `+ sum(remaining on ACTIVE packages)`. A Braces Adjustment `CHARGE` (planId set)
  and the payment that settles it (appliesTo a plan charge) are excluded from the
  ledger part — the package's own remaining already covers them.
- A treatment plan's `remaining` = `totalPrice − sum(payments toward the plan:
  planId == plan, or appliesTo one of the plan's CHARGEs)`.
- A standalone charge's remaining = `amount − sum(entries whose appliesToId == it)`.
- Never add a cached/denormalized balance column or persist a running total.
- **"Total Due" is the one user-facing label** for a patient's overall owed
  amount — patient header, patient list, Dashboard, Reports, Payment overview.
  Don't reintroduce "Balance due" / "Outstanding balance" / "Total outstanding".
  "remaining" stays for a single package or a single charge.

### 3. Patients are archived, never deleted (RA 10173)

- "Delete" = set `archived = true` (see the `DELETE /patients/:id` route, which
  only flips the flag). The row and all its history stay.
- No hard `DELETE` of `Patient` rows, and no cascade that would remove patient
  history. Archived patients are hidden from normal queries, not removed.

### 4. Every mutation writes an audit log row

- Any create / update / archive (and login) must call `audit({ userId, action,
  entity, entityId, detail })` from `server/src/lib/audit.js`.
- `audit_logs` is write-only history — never edit or delete rows from it in
  application code. Readable (OWNER only) at `GET /api/v1/audit` →
  `client/src/pages/Activity.jsx` ("Activity log" nav item).
- New mutating routes are not complete until they emit an audit entry. For a
  sensitive value change (package/procedure price, plan status, freebie/payment
  void) put `{ from, to }` (or the `reason`) in `detail`, not just the field name.
- Financial rows are never hard-deleted: void/refund/archive/reversal only.
  Appointment "delete" is an `archived` flag too.

### 5. Consent is required to register a patient

- Consent is captured at registration as `consentSignedAt` (`consentSigned: true`
  on the create payload sets the timestamp).
- The client UI refuses to save a patient without it — keep that check. Do not
  add a path that creates a patient with `consentSignedAt` null.
- **Duplicate guard**: `POST /patients` rejects (409 `{ possibleDuplicates }`) a
  non-archived patient with the same first+last name and, if given, the same
  phone. `force: true` overrides (audited as `forced`). The client shows the
  matches and re-submits with `force` on confirm.

### 6. Monthly Braces Adjustment — the one procedure with special billing

Everything else bills normally. A **Braces Adjustment** (procedure name matches
`/adjustment/i`) done on a patient with an ACTIVE INSTALLMENT plan can be charged
to that plan:

- The visit line carries `coveredByPlanId`. Server **rejects** `coveredByPlanId`
  on any non-adjustment procedure ("Only a Braces Adjustment can be charged to a
  package").
- It writes an ordinary `CHARGE` with that `planId`, `amount = priceCharged`
  (client default = `monthlyDue`), **capped at the plan's `remaining`**
  (`planRemaining`). It lands in the ledger **Unpaid**.
- Because it is plan-tied, it is **excluded from Total Due** (rule 2) — recording
  the adjustment does not change Total Due. The package's `remaining` also doesn't
  move (a charge isn't a payment).
- **Marking that charge Paid** = a `PAYMENT` with `appliesToId` = the charge
  (`recordChargePayment` → `syncPlanStatus`). That payment counts toward the plan,
  so the package `remaining` drops — and because Total Due includes package
  remaining, Total Due drops by the same amount. This is the *only* thing that
  deducts from the package.
- Creating a `TreatmentPlan` writes **no up-front price charge**; `downpayment` is
  a bare `PAYMENT` (`planId`) toward the plan.
- Plan `status` is **derived**: `PAID` when `remaining ≤ 0`, else `ACTIVE`.
- `recordPlanPayment` (plan-card "Record payment") still exists for pre-payments.
- `includedProcedures` is editable `Json` (documentation only, no billing effect).

## Package benefits / freebies — tracked consumables, NON-monetary

A benefit ("2 Free Fillings", "Ortho Kit") lives on one patient's plan as a
`PlanFreebie` row (snapshot from the template's `freebies` JSON). Its current
quantity and status are **derived** from an append-only `PlanFreebieEntry` log
(`server/src/lib/freebies.js` `freebieTotals`) — mirrors the ledger reversal
pattern:

- `used = Σ USE.qty` (permanent — visits aren't editable), `voided = Σ VOID −
  Σ RESTORE`, `remaining = max(0, qtyIncluded − used − voided)` (never < 0).
  Status: `AVAILABLE` / `USED` / `VOIDED`.
- **This never touches money.** `planTotals` / `computeDue` / `paymentOverview`
  read only `LedgerEntry` + `plan.totalPrice` — do not make them freebie-aware.
  A covered item is simply not charged; nothing is deducted from the package
  balance. Keep monetary and benefit tracking separate.
- **Consuming** (visit route): a `VisitProcedure` line sends `items: [{ price,
  covered }]`. `covered` items require `coveredByFreebieId` (a benefit whose
  `procedureId` matches the line's procedure, on an ACTIVE plan, with enough
  `remaining`). The line's `priceCharged` = Σ uncovered item prices → one CHARGE
  (`visitProcedureId` set); each covered set writes `PlanFreebieEntry` USE +
  `audit('USE','plan_freebie')`. `coveredByFreebieId` and `coveredByPlanId`
  (adjustment) are mutually exclusive.
- **Void / restore**: `POST /api/v1/patients/:pid/plans/:planId/freebies/:id/void`
  and `/restore` (`server/src/routes/freebies.js`), **OWNER only**, `{ qty,
  reason }` required, `qty` capped at `remaining` / `voided`. RESTORE only ever
  reverses a VOID. Both audit `plan_freebie`.
- Plan `present()` returns `freebies` with `used/voided/remaining/status/label/
  history`. PATCH `/plans/:id` reconciles `PlanFreebie` rows (match by `id`);
  a row with entries can't be deleted, and `qtyIncluded` can't drop below
  `used + voided`.

## Quantity / variable-price procedures

`Procedure.allowQuantity` (toggle on the Procedures page). When on, a visit line
records N items with a per-item editable price (`VisitProcedure.quantity` +
`items` JSON); the ledger still gets **one** CHARGE = the billable total, and
`LedgerEntry.visitProcedureId` links back so the ledger row and printable
statement can show the qty / per-item / covered / paid breakdown. When off, the
normal single-price line is unchanged.

## Package templates (catalog)

`package_templates` + `package_procedures` are a **reusable catalog**
(`server/src/routes/packages.js`, `/api/v1/packages`, OWNER/DENTIST only,
soft-deleted like the procedure catalog). A `TreatmentPlan` may be created with a
`templateId`; the client copies the template's `name / paymentType / defaultPrice
→ totalPrice / downpayment / monthlyDue / freebies / includedProcedures` into the
plan at creation. It is a **snapshot** — editing the template later never touches
existing plans, and every value stays editable per patient (braces prices vary).
Managed in the UI on the **Procedures page → Packages tab**. Template `freebies`
are `[{ name, procedureId?, qtyIncluded, notes? }]` — copied into `PlanFreebie`
rows when a plan is created from the template.

## Patient files (X-rays)

Uploaded images live on disk under `server/uploads/` (gitignored; `UPLOAD_DIR`
overrides the root, and on Vercel it falls back to `/tmp`); the
`patient_files` row is the metadata (`xrayType`, `description`, `notes`,
`takenAt`, plus `label`). Routes nested under `/api/v1/patients/:patientId/files`
(`server/src/routes/files.js`, `multer` disk storage, 15 MB, PNG/JPEG/WebP/PDF).
POST accepts the metadata as form fields; `PATCH /:fileId` edits it; binary
streams from `GET .../:fileId/raw`. Uploads always **add** — never replace an
older file. **Delete is OWNER/DENTIST only and audited (with detail)** — treat
X-rays as clinical records.

## Visits — performed-by and appointment link

- **`VisitProcedure.performedBy`** is a free-text dentist name, **per procedure
  line** (different procedures in one visit can have different dentists). It is
  never auto-filled from any "main dentist" (there is no such field). The visit
  form has a visit-level default that pre-fills *new* lines only. Server appends
  it to that procedure's `CHARGE` note (`"<proc> (tooth 12) · Dr. Cruz"`) so it
  shows in the ledger, transactions CSV, and printable statement with no join.
  `GET /api/v1/visit-performers` returns distinct past names for autocomplete.
  The old visit-level `Visit.dentistId` is unused, left in place.
- **`Visit.appointmentId`** (optional) links a visit to the appointment it
  fulfilled. Recording such a visit sets that appointment `COMPLETED` in the same
  transaction. "Record visit" on an appointment deep-links to
  `/patients/:id?tab=visits&fromAppt=:apptId&dentist=<name>` — the visit form
  prefills its date + performed-by from the appointment.
- The PatientDetail tab lives in the URL (`?tab=`), so a refresh keeps the tab.
- A printable per-patient statement is at `/patients/:id/statement`.

## Appointments & Dashboard

- `AppointmentStatus` = Scheduled / Confirmed / Completed / Cancelled / No-show
  (`ARRIVED`/`IN_CHAIR` are legacy enum values kept for old rows, not offered).
  `Appointment.dentist` is a free-text name (datalist from `/visit-performers`).
  `archived` flag = "delete". POST **and** PATCH return advisory
  `conflict` / `conflictSameDentist` / `conflictWith` (overlap check, never blocks).
- **`GET /api/v1/reports/dashboard`** — one call powering `Dashboard.jsx`:
  `{ income:{gross,refundsVoids,net}, outstanding:{total,rows},
  todayAppointments, todayPatientCount, upcoming, bracesDue, overdue }`. Reuses
  `rangeSummary` / `dueMap` / `enrichEntries`+`openCharges`. `plans.js present()`
  adds `nextAdjustmentDate` (last adjustment charge + 1 month).

## Payment overview

`GET /api/v1/patients/:id/payment-overview` (`server/src/lib/overview.js`) — a
read-only aggregate for the patient's **Payment overview** tab: `totals`
(charges / paid / discounts / ledgerBalance / **outstanding** = Total Due),
`braces` (packageTotal / paid / remaining + per-plan rows, CANCELLED plans
excluded), `latestPaymentDate`, `byTarget` (payments grouped by package /
procedure / general), `byMethod`, and `recentPayments` (last 8). It reuses
`planTotals` + `computeDue`; nothing stored. Does **not** replace the Ledger &
payments tab.

## Reports & exports

- Data builders live in `server/src/lib/reports.js` (`REPORTS` map:
  `income` | `outstanding-balances` | `transactions` | `visits`), each returning
  `{ rows, columns, filename }`. `transactions` / `visits` require `from`/`to`
  (YYYY-MM-DD), window capped at 366 days. CSV is written by `toCsv` / `sendCsv`
  in `server/src/lib/csv.js` (RFC-4180 quoting, `\r\n`, leading UTF-8 BOM for Excel).
- Authed download: `GET /api/v1/reports/:report.csv` (behind `requireAuth`,
  `Content-Disposition: attachment`). JSON report routes are unchanged.
- **Public spreadsheet feed**: `GET /api/v1/feed/:report.csv?token=…` — mounted in
  `index.js` **before** `app.use('/api/v1', requireAuth)`, guarded by
  `requireReportToken` (`server/src/middleware/reportToken.js`, constant-time check
  of `REPORT_TOKEN`). Unset env → 503; wrong token → 403. Served **inline** (no
  attachment) so Google Sheets `IMPORTDATA` / Excel "From Web" can read it.
  **This exposes financial data to anyone with the URL** — rotate `REPORT_TOKEN`
  and restart to revoke. `GET /reports/feed-info` (OWNER only) feeds the client's
  "Connect a spreadsheet" panel.

## Production & backups

`DEPLOY.md` is the runbook (systemd + Caddy + tuned Postgres + cron backups).
`server/scripts/backup.sh` (dump → gzip → `gzip -t` → rclone off-site → healthcheck)
and `restore.sh` (guarded drop + reload). `npm run db:backup` / `db:restore` /
`db:migrate:prod` (backup then `prisma migrate deploy`). **Never run
`prisma migrate reset` / `migrate dev` against production.**

## Roles

`OWNER` — everything. `DENTIST` — everything except (future) user management.
`STAFF` — patients, visits, ledger, appointments; **not** archiving patients,
editing the procedure catalog, deleting X-rays, or the report feed token panel.
Enforce with `requireRole(...)`.

## Local dev

No Docker on this machine — Postgres runs as a **native install** (service
`postgresql-x64-16`), with a `clinic` / `clinic_dev_pw` role and `clinic` db that
match `docker-compose.yml`, so `server/.env`'s `DATABASE_URL` is unchanged from
the example. Run `cd server && npm run dev` (API :4000) and `cd client && npm run
dev` (app :5173, proxies `/api`). `npm run db:seed` is idempotent.
