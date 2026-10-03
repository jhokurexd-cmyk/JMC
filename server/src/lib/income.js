import { prisma } from './prisma.js'

// Local-time day/week/month windows around a given date (defaults to now).
// Week runs Monday 00:00 → Sunday 23:59:59.
export function dayRange(date) {
  const d = date ? new Date(date) : new Date()
  const from = new Date(d)
  from.setHours(0, 0, 0, 0)
  const to = new Date(d)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

export function weekRange(date) {
  const { from: dayFrom } = dayRange(date)
  const mondayOffset = (dayFrom.getDay() + 6) % 7 // Sun=6, Mon=0, ...
  const from = new Date(dayFrom)
  from.setDate(from.getDate() - mondayOffset)
  const to = new Date(from)
  to.setDate(to.getDate() + 6)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

export function monthRange(date) {
  const { from: dayFrom } = dayRange(date)
  const from = new Date(dayFrom.getFullYear(), dayFrom.getMonth(), 1, 0, 0, 0, 0)
  const to = new Date(dayFrom.getFullYear(), dayFrom.getMonth() + 1, 0, 23, 59, 59, 999)
  return { from, to }
}

// Collected income for [from, to] — RETROACTIVE. A payment that is voided or
// refunded LATER simply drops out of its original period, so day/week/month
// always agree and always match `paymentOverview`.
//
//   gross       = Σ real PAYMENT rows dated in the window (incl. later-voided)
//   refundsVoids = Σ of those that have since been voided/refunded
//   net          = gross − refundsVoids   (what's actually still collected)
//
// Reversal rows themselves (reversalOfId set) never count — they only mark their
// original. `byMethod` and `count` and `total` all reflect NET.
export async function rangeSummary({ from, to }) {
  const rows = await prisma.ledgerEntry.findMany({
    where: { type: 'PAYMENT', createdAt: { gte: from, lte: to } },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      reversedBy: { select: { id: true, reversalKind: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  const real = rows.filter((p) => !p.reversalOfId)
  const live = real.filter((p) => p.reversedBy.length === 0)

  const gross = real.reduce((s, p) => s + Number(p.amount), 0)
  const net = live.reduce((s, p) => s + Number(p.amount), 0)
  const refundsVoids = gross - net

  const byMethod = {}
  for (const p of live) {
    const m = p.method ?? 'OTHER'
    byMethod[m] = (byMethod[m] ?? 0) + Number(p.amount)
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    gross,
    refundsVoids,
    net,
    total: net, // back-compat alias
    count: live.length,
    byMethod,
    payments: rows,
  }
}
