# Dental Clinic Management System

Patient records, visit history, procedures, installment ledgers (braces packages),
and appointment scheduling for a solo-dentist clinic.

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
  correcting entries. This is what makes the client's books auditable.
- **Patients are archived, never deleted** (RA 10173). The `archived` flag hides
  them; the data and audit history remain.
- **Every mutation writes an audit log row** — who, what, when (`audit_logs` table).
- **Treatment plans** charge their full price to the ledger at creation; installment
  payments are ordinary ledger payments linked by `planId`. Remaining balance is
  computed, never stored.
- **Consent is captured at registration** (`consentSignedAt`) and the UI refuses to
  save a patient without it.

## Useful commands

```bash
cd server
npm run db:studio       # browse the database in Prisma Studio
npx prisma migrate dev  # after editing schema.prisma
npm run db:seed         # idempotent, safe to re-run
```

## Production deployment (summary)

1. VPS (Ubuntu LTS): install Docker, clone repo.
2. Run Postgres + API behind Caddy (automatic HTTPS). Build the client
   (`npm run build`) and serve `client/dist` as static files.
3. Set strong `JWT_SECRET`s and a real `SEED_ADMIN_PASSWORD`; run
   `npx prisma migrate deploy && npm run db:seed`.
4. Backups: configure `rclone` with an off-site remote, then install
   `server/scripts/backup.sh` in cron (instructions inside the script).
   Add a healthchecks.io URL as `HEALTHCHECK_URL` so failed backups alert you.

## Roles

| Role    | Can do                                                        |
|---------|---------------------------------------------------------------|
| OWNER   | Everything                                                    |
| DENTIST | Everything except (future) user management                    |
| STAFF   | Patients, visits, ledger, appointments — not archiving patients or editing the procedure catalog |

New users are added directly in the database for now (hash a password with argon2
via `node -e` or Prisma Studio) — a Users admin page is on the phase-2 list.
