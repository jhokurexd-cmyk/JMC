import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncRoute } from '../middleware/errors.js'

const router = Router()

// GET /reports/daily-income?date=YYYY-MM-DD  (defaults to today)
router.get(
  '/daily-income',
  asyncRoute(async (req, res) => {
    const day = req.query.date ? new Date(req.query.date) : new Date()
    const start = new Date(day)
    start.setHours(0, 0, 0, 0)
    const end = new Date(day)
    end.setHours(23, 59, 59, 999)

    const payments = await prisma.ledgerEntry.findMany({
      where: { type: 'PAYMENT', createdAt: { gte: start, lte: end } },
      include: { patient: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const total = payments.reduce((s, p) => s + Number(p.amount), 0)
    const byMethod = {}
    for (const p of payments) {
      const m = p.method ?? 'OTHER'
      byMethod[m] = (byMethod[m] ?? 0) + Number(p.amount)
    }
    res.json({ date: start.toISOString().slice(0, 10), total, byMethod, payments })
  }),
)

// GET /reports/outstanding-balances — every patient who owes money
router.get(
  '/outstanding-balances',
  asyncRoute(async (req, res) => {
    const grouped = await prisma.ledgerEntry.groupBy({
      by: ['patientId', 'type'],
      _sum: { amount: true },
    })
    const balances = {}
    for (const g of grouped) {
      const sign = g.type === 'CHARGE' ? 1 : -1
      balances[g.patientId] = (balances[g.patientId] ?? 0) + sign * Number(g._sum.amount)
    }
    const owingIds = Object.keys(balances).filter((id) => balances[id] > 0)
    const patients = await prisma.patient.findMany({
      where: { id: { in: owingIds }, archived: false },
      select: { id: true, firstName: true, lastName: true, phone: true },
    })
    const rows = patients
      .map((p) => ({ ...p, balance: balances[p.id] }))
      .sort((a, b) => b.balance - a.balance)
    res.json({ totalOutstanding: rows.reduce((s, r) => s + r.balance, 0), rows })
  }),
)

export default router
