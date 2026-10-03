import { prisma } from './prisma.js'
import { HttpError } from '../middleware/errors.js'
import { rangeSummary, dayRange, weekRange, monthRange } from './income.js'
import { dueMap } from './balance.js'

const money = (n) => Number(n).toFixed(2)
const fmtDate = (d) => new Date(d).toISOString().slice(0, 10)
const fmtTime = (d) => new Date(d).toISOString().slice(11, 16)
const fullName = (p) => (p ? [p.lastName, p.firstName].filter(Boolean).join(', ') : '')

// from/to are YYYY-MM-DD; window capped so a report can't dump the whole database.
export function parseRange(q, maxDays = 366) {
  const { from, to } = q
  if (!from || !to) throw new HttpError(400, 'from and to dates are required (YYYY-MM-DD)')
  const start = new Date(`${from}T00:00:00.000`)
  const end = new Date(`${to}T23:59:59.999`)
  if (Number.isNaN(+start) || Number.isNaN(+end)) throw new HttpError(400, 'Invalid from/to date')
  if (end < start) throw new HttpError(400, 'to is before from')
  if ((end - start) / 86_400_000 > maxDays) throw new HttpError(400, `Range too wide (max ${maxDays} days)`)
  return { start, end, label: `${from}_to_${to}` }
}

// Income — the month's payments, with daily / weekly / monthly totals appended.
export async function incomeReport(date) {
  const [day, week, month] = await Promise.all([
    rangeSummary(dayRange(date)),
    rangeSummary(weekRange(date)),
    rangeSummary(monthRange(date)),
  ])
  const rows = month.payments
    .filter((p) => !p.reversalOfId)
    .map((p) => {
      const status = p.reversedBy?.length
        ? p.reversedBy[0].reversalKind === 'REFUND'
          ? 'REFUNDED'
          : 'VOIDED'
        : 'Collected'
      return {
        date: fmtDate(p.createdAt),
        time: fmtTime(p.createdAt),
        patient: fullName(p.patient),
        method: (p.method ?? 'OTHER').replace('_', ' '),
        note: p.note ?? '',
        status,
        amount: money(p.amount),
      }
    })
  const totalsFor = (r, label) => {
    rows.push({ patient: `${label} — gross`, amount: money(r.gross) })
    rows.push({ patient: `${label} — refunds & voids`, amount: money(-r.refundsVoids) })
    rows.push({ patient: `${label} — NET collected`, amount: money(r.net) })
  }
  rows.push({})
  totalsFor(day, `Daily (${fmtDate(day.from)})`)
  totalsFor(week, `Weekly (${fmtDate(week.from)} – ${fmtDate(week.to)})`)
  totalsFor(month, `Monthly (${fmtDate(month.from)} – ${fmtDate(month.to)})`)
  rows.push({})
  for (const [m, v] of Object.entries(month.byMethod)) {
    rows.push({ patient: `  ${m.replace('_', ' ').toLowerCase()} (net)`, amount: money(v) })
  }
  return {
    filename: `income_${fmtDate(month.from).slice(0, 7)}`,
    columns: [
      { key: 'date', header: 'Date' },
      { key: 'time', header: 'Time' },
      { key: 'patient', header: 'Patient' },
      { key: 'method', header: 'Method' },
      { key: 'note', header: 'Note' },
      { key: 'status', header: 'Status' },
      { key: 'amount', header: 'Amount' },
    ],
    rows,
  }
}

// Outstanding balances — every patient with money owed (Total Due), + a TOTAL row.
export async function outstandingReport() {
  const patients = await prisma.patient.findMany({
    where: { archived: false },
    select: { id: true, firstName: true, lastName: true, phone: true },
  })
  const due = await dueMap(patients.map((p) => p.id))
  const owing = patients
    .map((p) => ({ ...p, balance: due[p.id] ?? 0 }))
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance)
  const rows = owing.map((r) => ({ patient: fullName(r), phone: r.phone ?? '', due: money(r.balance) }))
  rows.push({ patient: 'TOTAL', due: money(owing.reduce((s, r) => s + r.balance, 0)) })
  return {
    filename: `outstanding-balances_${fmtDate(new Date())}`,
    columns: [
      { key: 'patient', header: 'Patient' },
      { key: 'phone', header: 'Phone' },
      { key: 'due', header: 'Total Due' },
    ],
    rows,
  }
}

// All ledger transactions in a date range (accounting export).
export async function transactionsReport(q) {
  const { start, end, label } = parseRange(q)
  const entries = await prisma.ledgerEntry.findMany({
    where: { createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: 'asc' },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      plan: { select: { name: true } },
      appliesTo: { select: { note: true } },
      author: { select: { name: true } },
      reversedBy: { select: { reversalKind: true } },
    },
  })
  const statusOf = (e) => {
    if (e.reversalOfId) return e.reversalKind === 'REFUND' ? 'Refund reversal' : 'Void reversal'
    if (e.reversedBy?.length) return e.reversedBy[0].reversalKind === 'REFUND' ? 'Refunded' : 'Voided'
    return 'Active'
  }
  const rows = entries.map((e) => ({
    date: fmtDate(e.createdAt),
    time: fmtTime(e.createdAt),
    patient: fullName(e.patient),
    type: e.type,
    amount: money(e.amount),
    signed: money((e.type === 'CHARGE' ? 1 : -1) * Number(e.amount)),
    status: statusOf(e),
    receiptNo: e.receiptNo ?? '',
    method: e.method ? e.method.replace('_', ' ') : '',
    note: e.note ?? '',
    package: e.plan?.name ?? '',
    appliesTo: e.appliesTo?.note ?? '',
    by: e.author?.name ?? '',
  }))
  return {
    filename: `transactions_${label}`,
    columns: [
      { key: 'date', header: 'Date' },
      { key: 'time', header: 'Time' },
      { key: 'patient', header: 'Patient' },
      { key: 'type', header: 'Type' },
      { key: 'amount', header: 'Amount' },
      { key: 'signed', header: 'Signed (charge +, payment −)' },
      { key: 'status', header: 'Status' },
      { key: 'receiptNo', header: 'Receipt #' },
      { key: 'method', header: 'Method' },
      { key: 'note', header: 'Note' },
      { key: 'package', header: 'Package' },
      { key: 'appliesTo', header: 'Applies to' },
      { key: 'by', header: 'Recorded by' },
    ],
    rows,
  }
}

// Visits & procedures in a date range — one row per procedure done.
export async function visitsReport(q) {
  const { start, end, label } = parseRange(q)
  const visits = await prisma.visit.findMany({
    where: { visitDate: { gte: start, lte: end } },
    orderBy: { visitDate: 'asc' },
    include: {
      patient: { select: { firstName: true, lastName: true } },
      procedures: {
        include: {
          procedure: { select: { name: true } },
          coveredByPlan: { select: { name: true } },
          coveredByFreebie: { select: { name: true } },
        },
      },
    },
  })
  const rows = []
  for (const v of visits) {
    const base = {
      date: fmtDate(v.visitDate),
      patient: fullName(v.patient),
      notes: v.notes ?? '',
    }
    if (v.procedures.length === 0) {
      rows.push({ ...base, procedure: '', qty: '', performedBy: '', price: '', coveredBy: '' })
    } else {
      for (const p of v.procedures) {
        rows.push({
          ...base,
          procedure: p.procedure.name,
          qty: p.quantity ?? 1,
          performedBy: p.performedBy ?? '',
          price: money(p.priceCharged),
          coveredBy: p.coveredByPlan?.name ?? p.coveredByFreebie?.name ?? '',
        })
      }
    }
  }
  return {
    filename: `visits_${label}`,
    columns: [
      { key: 'date', header: 'Visit date' },
      { key: 'patient', header: 'Patient' },
      { key: 'procedure', header: 'Procedure' },
      { key: 'qty', header: 'Qty' },
      { key: 'performedBy', header: 'Performed by' },
      { key: 'price', header: 'Price' },
      { key: 'coveredBy', header: 'Covered by' },
      { key: 'notes', header: 'Visit notes' },
    ],
    rows,
  }
}

export const REPORTS = {
  income: (q) => incomeReport(q.date),
  'outstanding-balances': () => outstandingReport(),
  transactions: (q) => transactionsReport(q),
  visits: (q) => visitsReport(q),
}
