import { prisma } from './prisma.js'
import { planTotals } from './plans.js'
import { activeEntries } from './entries.js'

const ENTRY_COLS = {
  select: { id: true, type: true, amount: true, planId: true, appliesToId: true, reversalOfId: true },
}

// Total Due =
//   ledger balance from entries NOT tied to a package
//   + Σ remaining on ACTIVE packages.
//
// A Monthly Braces Adjustment charge (planId set) and the payment that settles it
// (appliesToId → a plan charge) are excluded from the ledger part — the package's
// own remaining already accounts for them. So recording an adjustment does not
// move Total Due; marking it Paid lowers the package remaining, which lowers
// Total Due. Every other charge behaves normally.
export function computeDue(rawEntries, activePlansWithTotals) {
  const entries = activeEntries(rawEntries)
  const planChargeIds = new Set(entries.filter((e) => e.type === 'CHARGE' && e.planId).map((e) => e.id))
  const ledgerPart = entries.reduce((sum, e) => {
    const planRelated = e.planId != null || (e.appliesToId != null && planChargeIds.has(e.appliesToId))
    if (planRelated) return sum
    return sum + (e.type === 'CHARGE' ? 1 : -1) * Number(e.amount)
  }, 0)
  const planPart = activePlansWithTotals.reduce((s, p) => s + Math.max(0, p.remaining), 0)
  return ledgerPart + planPart
}

// Total Due for one patient. Pass a `$transaction` client as `db` to read the
// in-flight state (used to snapshot balanceBefore/balanceAfter on a receipt).
export async function patientDue(patientId, db = prisma) {
  const [entries, plans] = await Promise.all([
    db.ledgerEntry.findMany({ where: { patientId }, ...ENTRY_COLS }),
    db.treatmentPlan.findMany({
      where: { patientId, status: 'ACTIVE' },
      select: { id: true, totalPrice: true },
    }),
  ])
  const withTotals = plans.map((p) => ({ ...p, ...planTotals(p, entries) }))
  return computeDue(entries, withTotals)
}

// Batch: Total Due for many patients in two bulk queries.
export async function dueMap(patientIds) {
  if (patientIds.length === 0) return {}
  const [entries, plans] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { patientId: { in: patientIds } },
      select: {
        id: true,
        patientId: true,
        type: true,
        amount: true,
        planId: true,
        appliesToId: true,
        reversalOfId: true,
      },
    }),
    prisma.treatmentPlan.findMany({
      where: { patientId: { in: patientIds }, status: 'ACTIVE' },
      select: { id: true, patientId: true, totalPrice: true },
    }),
  ])
  const byId = {}
  for (const id of patientIds) byId[id] = { entries: [], plans: [] }
  for (const e of entries) byId[e.patientId]?.entries.push(e)
  for (const p of plans) byId[p.patientId]?.plans.push(p)

  const map = {}
  for (const id of patientIds) {
    const { entries: es, plans: pl } = byId[id]
    const withTotals = pl.map((p) => ({ ...p, ...planTotals(p, es) }))
    map[id] = computeDue(es, withTotals)
  }
  return map
}
