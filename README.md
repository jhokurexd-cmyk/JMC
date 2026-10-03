# Dental Clinic Management System

Patient records, visit history, procedures, installment ledgers (per-patient
braces packages with editable price and freebies), X-ray images, appointment
scheduling, and daily / weekly / monthly income tracking for a solo-dentist clinic.

**Stack:** React + Vite · Node.js + Express · Prisma · PostgreSQL

```
dental-clinic/
├── server/          Express API + Prisma schema + backup script
├── client/          React app (talks to the API, proxied in dev)
└── docker-compose.yml   Local PostgreSQL
```

## First-time setup

Requirements: Node.js 20+, and PostgreSQL via **either** Docker Desktop **or** a local install.

### 1. Database

**Docker route (recommended):**
```bash
docker compose up -d        # starts Postgres 16 on localhost:5432
```

**Direct-install route:** create a database and user matching `server/.env.example`,
or edit `DATABASE_URL` to match what you created.

**Shared cloud DB route (team dev):** create a free Postgres on Neon/Supabase and put
its connection string in `DATABASE_URL` — teammates share one database, no local install.

### 2. Server

```bash
cd server
cp .env.example .env        # then edit: set real JWT secrets!
npm install
npx prisma migrate dev --name init   # creates all tables
npm run db:seed             # admin user + PH procedure catalog
npm run dev                 # API on http://localhost:4000
```

The seed creates the first login from `.env`:
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (change these before running!).

### 3. Client

```bash
cd client
npm install
npm run dev                 # app on http://localhost:5173
```

Sign in with the seeded admin account. Vite proxies `/api` to the server, so no
CORS setup is needed in development.

## Key design rules (do not break these)

- **The ledger is append-only.** There is no API route to edit or delete a ledger
  entry. Balances are computed from entries, never stored. Fix mistakes with
  correcting entries. This is what makes the client's books auditable. A payment or
  discount can optionally be applied to one specific charge (`appliesToId`) so the
  clinic can see which individual charges are settled; it's capped at that charge's
  remaining and doesn't change the overall balance formula.
- **Undo a payment with Void.** On the Ledger & payments tab, a payment or
  discount can be voided: it appends a linked reversal entry and the original
  stops counting everywhere (Total Due, package balance, income, per-charge
  status) — the row stays in the history, struck through. Still no edit/delete.
- **"Total Due"** is the one term for what a patient owes overall (header, list,
  dashboard, reports). Per-package / per-charge figures are called "remaining".
- **Performed by** is recorded per procedure on a visit — a free-text dentist
  name, so different procedures in one visit can credit different dentists. It
  shows in visit history, the ledger note, reports, and the printable statement
  (button on the patient header).
- **Appointments** can be closed out by a visit: "Record visit" on an appointment
  opens the visit form, and saving it marks the appointment Completed.
- **Package benefits / freebies are tracked consumables.** A braces package can
  include e.g. "2 Free Fillings" (link a benefit to a procedure + set a quantity).
  Each patient's plan shows used / remaining / status per benefit. During a visit,
  staff tick which individual items a benefit covers — covered items aren't
  charged and **never touch the package money balance**. The Owner can void unused
  benefit quantity (reason required) or restore a mistaken void; every use / void
  / restore is in the benefit's log and the audit trail.
- **Quantity procedures.** Turn on "Allow quantity / multiple items" for a
  procedure (e.g. Filling) and a visit can record N of it with a per-item price;
  the ledger still gets one charge, and the row expands to the per-item breakdown.
- **Payments are their own tab.** Ledger holds charges/discounts; **Payments**
  holds the receipt list. Every payment gets a sequential number (`OR-000001`), a
  printable receipt with previous/remaining balance, and a status
  (Paid / Voided / Refunded). **Void** = recorded by mistake; **Refund** = money
  returned (records the return method). Both correct the balance and, being
  retroactive, pull the payment out of its original day/week/month so Dashboard,
  Reports and Income always agree — even months later.
- **Appointments** carry a dentist and use Scheduled / Confirmed / Completed /
  Cancelled / No-show. Overlapping bookings warn (louder for the same dentist)
  without blocking; marking one Completed offers "Record visit now". "Delete"
  archives.
- **Dashboard** shows today's appointments & patients, net income today,
  outstanding total, upcoming appointments, braces adjustments due, and overdue
  balances — from one endpoint.
- **X-rays** carry a type, date taken, description and notes (all editable), and
  new uploads are always added alongside the old ones.
- **Activity log** (`/activity`, owner only) lists every sensitive action — price
  edits, voids, refunds, freebie voids, archives — with who / when / what changed.
- Registering a patient with a name + phone that already exists is blocked with a
  warning (and the list of matches) until you confirm.
- **Patients are archived, never deleted** (RA 10173). The `archived` flag hides
  them; the data and audit history remain.
- **Every mutation writes an audit log row** — who, what, when (`audit_logs` table).
- **Only the Monthly Braces Adjustment procedure has special billing** — every
  other procedure bills normally. Recording an adjustment visit puts a `CHARGE`
  (default `monthlyDue`) in the ledger as **Unpaid**, but it is **not added to
  Total Due** (the braces package balance already covers it). On the **Ledger &
  payments** tab, **Mark paid** on that charge records the payment and deducts it
  from **both the package's remaining balance and Total Due** — e.g. package
  ₱50,000, adjustment ₱2,000 → recording keeps Total Due at ₱50,000, marking Paid
  makes both ₱48,000. The plan auto-marks **Paid** at ₱0. Creating a package writes
  no up-front charge (just the downpayment). Total Due = ledger balance from
  non-package entries + Σ remaining on active packages.
- **Packages are per patient and editable** — `totalPrice`, `monthlyDue`, `freebies`
  (Ortho Kit, Retainer, …), `includedProcedures`. Editing the price just re-derives
  the remaining balance. Reusable package templates are defined on the Procedures
  page → **Packages** tab; "Start from package" pre-fills a patient's plan.
- **X-ray images** are stored under `server/uploads/` with a `patient_files` metadata
  row; deleting one is OWNER/DENTIST-only and audited.
- **Income** (`/income`) totals `PAYMENT` ledger entries by day, week (Mon–Sun) and
  calendar month.
- **Reports export**: every report (income, outstanding balances, a full
  transactions/ledger dump, a visits & procedures log) has a **Download CSV**
  button. Set `REPORT_TOKEN` in `server/.env` to also expose a read-only feed at
  `/api/v1/feed/<report>.csv?token=…` that Google Sheets (`IMPORTDATA`) and Excel
  (Data → From Web) can subscribe to; the Reports page shows the ready-to-paste
  links (OWNER only). Rotate the token to revoke.
- **Payment overview** — each patient record has a read-only summary tab: total
  charges / paid / discounts, outstanding balance, braces package total / paid /
  remaining, latest payment date, payments broken down by procedure/package and by
  method, and a recent-payments list. It sits alongside (does not replace) the full
  Ledger & payments tab.
- **Consent is captured at registration** (`consentSignedAt`) and the UI refuses to
  save a patient without it.

## Useful commands

```bash
cd server
npm run db:studio       # browse the database in Prisma Studio
npx prisma migrate dev  # after editing schema.prisma
npm run db:seed         # idempotent, safe to re-run
```

## Production deployment

See **[DEPLOY.md](DEPLOY.md)** — the full runbook: Postgres install + tuning,
systemd unit, Caddyfile (auto-HTTPS + static client + API proxy),
`npm run db:migrate:prod`, nightly off-site backups (`server/scripts/backup.sh` +
`restore.sh`), a **restore-drill checklist**, and point-in-time-recovery options.
Short version: strong secrets in `server/.env`, `prisma migrate deploy` (never
`migrate dev`/`reset`), and a *tested* off-site backup.

## Roles

| Role    | Can do                                                        |
|---------|---------------------------------------------------------------|
| OWNER   | Everything                                                    |
| DENTIST | Everything except (future) user management                    |
| STAFF   | Patients, visits, ledger, appointments, packages, X-ray uploads — not archiving patients, editing the procedure catalog, or deleting X-ray images |

New users are added directly in the database for now (hash a password with argon2
via `node -e` or Prisma Studio) — a Users admin page is on the phase-2 list.
