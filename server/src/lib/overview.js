import { prisma } from './prisma.js'
import { planTotals } from './plans.js'
import { computeDue } from './balance.js'
import { activeEntries } from './entries.js'

// A read-only financial snapshot of one patient — totals, braces-package figures,
// payment breakdowns, and the most recent payments. Everything is derived from
// the ledger + plans; nothing is stored.
export async function paymentOverview(patientId) {
  const [rawEntries, plans] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { patientId },
      orderBy: { createdAt: 'asc' },
      include: { plan: { select: { name: true } }, appliesTo: { select: { id: true, note: true } } },
    }),
    prisma.treatmentPlan.findMany({ where: { patientId }, orderBy: { createdAt: 'asc' } }),
  ])
  // Voided payments and their reversal rows cancel out everywhere in this snapshot.
  const entries = activeEntries(rawEntries)

  const sum = (t) => entries.filter((e) => e.type === t).reduce((s, e) => s + Number(e.amount), 0)
  const charges = sum('CHARGE')
  const paid = sum('PAYMENT')
  const discounts = sum('DISCOUNT')

  // braces / treatment packages (CANCELLED plans don't count toward what's owed)
  const livePlans = plans.filter((p) => p.status !== 'CANCELLED')
  const planRows = livePlans.map((p) => {
    const t = planTotals(p, entries)
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      totalPrice: Number(p.totalPrice),
      paid: t.paid,
      remaining: Math.max(0, t.remaining),
    }
  })
  const braces = {
    packageTotal: planRows.reduce((s, r) => s + r.totalPrice, 0),
    paid: planRows.reduce((s, r) => s + r.paid, 0),
    remaining: planRows.reduce((s, r) => s + r.remaining, 0),
    plans: planRows,
  }

  // Total Due (Braces Adjustment charges excluded; active package remaining added)
  const activeWithTotals = plans
    .filter((p) => p.status === 'ACTIVE')
    .map((p) => ({ ...p, ...planTotals(p, entries) }))
  const outstanding = computeDue(entries, activeWithTotals)

  const payments = entries.filter((e) => e.type === 'PAYMENT')
  const latestPaymentDate = payments.length ? payments[payments.length - 1].createdAt : null

  // payments grouped by what they were for (package / procedure / general)
  const chargeById = new Map(entries.filter((e) => e.type === 'CHARGE').map((e) => [e.id, e]))
  const planNameById = new Map(plans.map((p) => [p.id, p.name]))
  const targetOf = (p) => {
    if (p.planId && planNameById.has(p.planId)) return { label: planNameById.get(p.planId), kind: 'package' }
    if (p.appliesToId && chargeById.has(p.appliesToId)) {
      const c = chargeById.get(p.appliesToId)
      if (c.planId && planNameById.has(c.planId)) return { label: planNameById.get(c.planId), kind: 'package' }
      return { label: c.note || 'Charge', kind: 'procedure' }
    }
    return { label: 'General / unallocated', kind: 'general' }
  }
  const byTargetMap = {}
  for (const p of payments) {
    const { label, kind } = targetOf(p)
    const row = (byTargetMap[label] ??= { label, kind, amount: 0, count: 0 })
    row.amount += Number(p.amount)
    row.count += 1
  }
  const byTarget = Object.values(byTargetMap).sort((a, b) => b.amount - a.amount)

  const byMethodMap = {}
  for (const p of payments) {
    const m = p.method ?? 'OTHER'
    const row = (byMethodMap[m] ??= { method: m, amount: 0, count: 0 })
    row.amount += Number(p.amount)
    row.count += 1
  }
  const byMethod = Object.values(byMethodMap).sort((a, b) => b.amount - a.amount)

  const recentPayments = payments
    .slice(-8)
    .reverse()
    .map((p) => ({
      id: p.id,
      date: p.createdAt,
      amount: Number(p.amount),
      method: p.method ?? null,
      forLabel: targetOf(p).label,
    }))

  return {
    totals: { charges, paid, discounts, ledgerBalance: charges - paid - discounts, outstanding },
    braces,
    latestPaymentDate,
    byTarget,
    byMethod,
    recentPayments,
    paymentCount: payments.length,
  }
}
