# Production deployment & data safety

The stack (PostgreSQL + Node/Express + a static React build) handles hundreds of
visits/day for years on a single small VPS. "No data loss" is an **operations**
job, not a code one — the two things that actually matter are **tested off-site
backups** and **not running destructive commands in production**.

---

## 1. Server + PostgreSQL (Ubuntu LTS)

```bash
sudo apt update && sudo apt install -y postgresql postgresql-contrib nodejs npm caddy
sudo -u postgres psql -c "CREATE ROLE clinic LOGIN PASSWORD 'STRONG_PW';"
sudo -u postgres psql -c "CREATE DATABASE clinic OWNER clinic;"
```

Tune `/etc/postgresql/*/main/postgresql.conf` for a 4 GB box (restart after):

```conf
shared_buffers = 1GB
effective_cache_size = 3GB
work_mem = 16MB
maintenance_work_mem = 256MB
max_connections = 50
synchronous_commit = on        # committed data survives a crash — leave ON
wal_level = replica            # enables PITR / streaming replication later
full_page_writes = on
```

## 2. App

```bash
sudo git clone <repo> /opt/clinic && cd /opt/clinic/dental-clinic

# server
cd server
cp .env.example .env      # then edit — see below
npm ci --omit=dev
npx prisma migrate deploy   # NEVER `migrate dev` / `migrate reset` in prod
npm run db:seed             # first run only

# client (static build served by Caddy)
cd ../client && npm ci && npm run build   # -> client/dist
```

`server/.env` for production:

| var | value |
|---|---|
| `DATABASE_URL` | `postgresql://clinic:STRONG_PW@localhost:5432/clinic?schema=public` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | two different 48+ byte random strings (`openssl rand -base64 48`) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | a real address + strong password (change immediately after first login) |
| `CLIENT_ORIGIN` / `PUBLIC_URL` | `https://clinic.example.com` |
| `REPORT_TOKEN` | long random string, or leave blank to disable the spreadsheet feed |
| `NODE_ENV` | `production` |

## 3. Run the API under systemd

`/etc/systemd/system/clinic-api.service`:

```ini
[Unit]
Description=Clinic API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/clinic/dental-clinic/server
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
User=clinic
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now clinic-api
```

## 4. Caddy — TLS + static client + API proxy

`/etc/caddy/Caddyfile`:

```
clinic.example.com {
    root * /opt/clinic/dental-clinic/client/dist
    encode gzip
    @api path /api/*
    handle @api { reverse_proxy localhost:4000 }
    handle { try_files {path} /index.html; file_server }
}
```

`sudo systemctl reload caddy` — HTTPS is automatic.

---

## 5. Backups (do NOT skip the restore drill)

`server/scripts/backup.sh` dumps → gzips → verifies (`gzip -t`) → ships off-site
with `rclone` → pings healthchecks.io.

```bash
sudo -u postgres rclone config          # add a remote named "offsite" (B2 / Drive / S3)
crontab -e
# nightly at 02:00
0 2 * * * cd /opt/clinic/dental-clinic/server && set -a && . ./.env && set +a \
  && BACKUP_DIR=/opt/clinic/backups RCLONE_REMOTE=offsite:clinic-backups \
  HEALTHCHECK_URL=https://hc-ping.com/XXXX bash scripts/backup.sh >> /var/log/clinic-backup.log 2>&1
```

- Local copies kept 7 days; set a lifecycle/retention rule on the remote bucket.
- `HEALTHCHECK_URL` (healthchecks.io) alerts you if a nightly run is ever missed.

**Restore drill — run this once now and every quarter:**

```bash
cd /opt/clinic/dental-clinic/server
rclone copy offsite:clinic-backups/clinic_LATEST.sql.gz /tmp/
# restore into a scratch DB, not production:
DATABASE_URL='postgresql://clinic:STRONG_PW@localhost:5432/clinic_restore_test?schema=public' \
  bash scripts/restore.sh /tmp/clinic_LATEST.sql.gz
# spot-check row counts, then drop clinic_restore_test
```

Nightly `pg_dump` means up to ~24h of data can be lost on a hardware failure. If
that window is unacceptable, add **point-in-time recovery**:
- `pgBackRest` or `wal-g` archiving WAL to the same off-site bucket, **or**
- run on **managed Postgres** (Neon / Supabase / RDS) which gives automated PITR
  + read replicas out of the box. Point `DATABASE_URL` at it and you're done.

## 6. Migrations & guardrails

- Deploy migrations with `npm run db:migrate:prod` (takes a backup first, then
  `prisma migrate deploy`).
- **Never** run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`
  against production — they can drop data.
- Give the app's DB role only what it needs; keep the superuser password off the
  app server.

---

## Performance note

`computeDue` / `dueMap` (`server/src/lib/balance.js`) — used by the patient list,
the ledger view, and the Outstanding-balances / Transactions reports — load a
patient's ledger rows and sum them in JS. That's fine for years at hundreds of
visits/day (rows are indexed on `(patientId, createdAt)`), but if the patient list
or those reports get sluggish, replace it with an indexed SQL aggregate or a
cached `Patient.balance` column updated on each ledger write (safe to denormalize —
the ledger is append-only). `ledger_entries` / `audit_logs` grow unbounded;
consider monthly partitioning or cold-row archival after a few years.
