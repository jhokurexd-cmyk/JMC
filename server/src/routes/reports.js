import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncRoute } from '../middleware/errors.js'
import { requireRole } from '../middleware/auth.js'
import { rangeSummary, dayRange, weekRange, monthRange } from '../lib/income.js'
import { dueMap } from '../lib/balance.js'
import { enrichEntries, openCharges } from '../lib/ledger.js'
import { REPORTS } from '../lib/reports.js'
import { sendCsv } from '../lib/csv.js'

const router = Router()

const addMonths = (d, n) => {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

// GET /reports/daily-income?date=YYYY-MM-DD  (defaults to today)
router.get(
  '/daily-income',
  asyncRoute(async (req, res) => {
    const range = dayRange(req.query.date)
    const summary = await rangeSummary(range)
    res.json({ date: range.from.toISOString().slice(0, 10), ...summary })
  }),
)

// GET /reports/income?date=YYYY-MM-DD  — daily, weekly and monthly income
router.get(
  '/income',
  asyncRoute(async (req, res) => {
    const { date } = req.query
    const [day, week, month] = await Promise.all([
      rangeSummary(dayRange(date)),
      rangeSummary(weekRange(date)),
      rangeSummary(monthRange(date)),
    ])
    res.json({ day, week, month })
  }),
)

// GET /reports/outstanding-balances — every patient who owes money (Total Due)
router.get(
  '/outstanding-balances',
  asyncRoute(async (req, res) => {
    const patients = await prisma.patient.findMany({
      where: { archived: false },
      select: { id: true, firstName: true, lastName: true, phone: true },
    })
    const due = await dueMap(patients.map((p) => p.id))
    const rows = patients
      .map((p) => ({ ...p, balance: due[p.id] ?? 0 }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance)
    res.json({ totalOutstanding: rows.reduce((s, r) => s + r.balance, 0), rows })
  }),
)

// GET /reports/dashboard — one call for the whole Dashboard page.
router.get(
  '/dashboard',
  asyncRoute(async (req, res) => {
    const now = new Date()
    const { from: dayStart, to: dayEnd } = dayRange()
    const in7 = addMonths(now, 0)
    in7.setDate(in7.getDate() + 7)

    const [incomeSummary, patients, todayAppts, upcoming, plans] = await Promise.all([
      rangeSummary(dayRange()),
      prisma.patient.findMany({ where: { archived: false }, select: { id: true, firstName: true, lastName: true, phone: true } }),
      prisma.appointment.findMany({
        where: { archived: false, startsAt: { gte: dayStart, lte: dayEnd } },
        orderBy: { startsAt: 'asc' },
      }),
      prisma.appointment.findMany({
        where: { archived: false, startsAt: { gt: now }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
        orderBy: { startsAt: 'asc' },
        take: 6,
      }),
      prisma.treatmentPlan.findMany({
        where: { status: 'ACTIVE', paymentType: 'INSTALLMENT' },
        select: { id: true, name: true, patientId: true, monthlyDue: true, startDate: true, createdAt: true, patient: { select: { firstName: true, lastName: true } } },
      }),
    ])

    // Total Due per patient
    const due = await dueMap(patients.map((p) => p.id))
    const owing = patients
      .map((p) => ({ id: p.id, name: [p.lastName, p.firstName].filter(Boolean).join(', '), phone: p.phone ?? '', balance: due[p.id] ?? 0 }))
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance)

    // Today's distinct patients (appointments today + visits today)
    const todayVisits = await prisma.visit.findMany({
      where: { visitDate: { gte: dayStart, lte: dayEnd } },
      select: { patientId: true },
    })
    const todayPatients = new Set([
      ...todayAppts.filter((a) => a.patientId).map((a) => a.patientId),
      ...todayVisits.map((v) => v.patientId),
    ])

    // Braces adjustments due within 7 days (or overdue)
    const planIds = plans.map((p) => p.id)
    const lastAdj = planIds.length
      ? await prisma.ledgerEntry.groupBy({
          by: ['planId'],
          where: { type: 'CHARGE', planId: { in: planIds }, reversalOfId: null },
          _max: { createdAt: true },
        })
      : []
    const lastAdjBy = Object.fromEntries(lastAdj.map((r) => [r.planId, r._max.createdAt]))
    const bracesDue = plans
      .map((p) => {
        const anchor = lastAdjBy[p.id] || p.startDate || p.createdAt
        const nextDate = addMonths(anchor, 1)
        return {
          patientId: p.patientId,
          patientName: [p.patient.lastName, p.patient.firstName].filter(Boolean).join(', '),
          planName: p.name,
          monthlyDue: p.monthlyDue,
          nextDate,
        }
      })
      .filter((r) => r.nextDate <= in7)
      .sort((a, b) => a.nextDate - b.nextDate)

    // Overdue: an owing patient whose oldest still-unpaid charge is > 30 days old
    const owingIds = owing.map((r) => r.id)
    const entries = owingIds.length
      ? await prisma.ledgerEntry.findMany({
          where: { patientId: { in: owingIds } },
          include: { plan: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        })
      : []
    const byPatient = {}
    for (const e of entries) (byPatient[e.patientId] ??= []).push(e)
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - 30)
    const overdue = owing
      .map((r) => {
        const open = openCharges(enrichEntries(byPatient[r.id] ?? []))
        const oldest = open[0]
        return oldest && new Date(oldest.createdAt) < cutoff
          ? { patientId: r.id, patientName: r.name, balance: r.balance, since: oldest.createdAt }
          : null
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.since) - new Date(b.since))

    res.json({
      income: { gross: incomeSummary.gross, refundsVoids: incomeSummary.refundsVoids, net: incomeSummary.net },
      outstanding: { total: owing.reduce((s, r) => s + r.balance, 0), rows: owing.slice(0, 12) },
      todayAppointments: todayAppts,
      todayPatientCount: todayPatients.size,
      totalPatients: patients.length,
      upcoming,
      bracesDue,
      overdue,
    })
  }),
)

// Where the client's "Connect a spreadsheet" panel gets the feed URL + token.
router.get(
  '/feed-info',
  requireRole('OWNER'),
  asyncRoute(async (req, res) => {
    const token = process.env.REPORT_TOKEN || null
    const baseUrl = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    res.json({ configured: Boolean(token), baseUrl, token })
  }),
)

// GET /reports/:report.csv — authed CSV download (in-app "Download CSV" buttons)
router.get(
  '/:report.csv',
  asyncRoute(async (req, res) => {
    const build = REPORTS[req.params.report]
    if (!build) return res.status(404).json({ error: 'Unknown report' })
    sendCsv(res, await build(req.query), { attachment: true })
  }),
)

export default router
