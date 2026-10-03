import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'
import { planTotals, recordPlanPayment, syncPlanStatus, PAYMENT_METHODS } from '../lib/plans.js'
import { activeEntries } from '../lib/entries.js'
import { freebiesForPlans, freebieTotals } from '../lib/freebies.js'

const router = Router({ mergeParams: true })

// A package benefit / freebie — a tracked consumable (2 Free Fillings) or a
// one-off perk (Ortho Kit). `procedureId` links it to a catalog procedure so a
// visit line for that procedure can consume it. Non-monetary — never affects
// the package balance. `id` is present when editing an existing row.
const freebieSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  procedureId: z.string().uuid().optional().nullable(),
  qtyIncluded: z.coerce.number().int().min(1).default(1),
  notes: z.string().optional().nullable(),
})

// Procedures a package covers — documentation only, not billed separately.
const includedProcedureSchema = z.object({
  procedureId: z.string().uuid().optional().nullable(),
  name: z.string().min(1),
})

const planSchema = z
  .object({
    name: z.string().min(1),
    templateId: z.string().uuid().optional().nullable(),
    paymentType: z.enum(['CASH', 'INSTALLMENT']).default('CASH'),
    totalPrice: z.coerce.number().positive(),
    downpayment: z.coerce.number().nonnegative().optional().nullable(),
    downpaymentMethod: z.enum(PAYMENT_METHODS).optional().nullable(),
    monthlyDue: z.coerce.number().nonnegative().optional().nullable(),
    startDate: z.coerce.date().optional().nullable(),
    notes: z.string().optional().nullable(),
    freebies: z.array(freebieSchema).optional().nullable(),
    includedProcedures: z.array(includedProcedureSchema).optional().nullable(),
  })
  .refine((d) => d.paymentType !== 'INSTALLMENT' || (d.downpayment ?? 0) > 0, {
    message: 'Installment plans need a downpayment',
    path: ['downpayment'],
  })
  .refine((d) => d.paymentType !== 'INSTALLMENT' || (d.monthlyDue ?? 0) > 0, {
    message: 'Installment plans need a monthly due amount',
    path: ['monthlyDue'],
  })
  .refine((d) => (d.downpayment ?? 0) <= d.totalPrice, {
    message: 'Downpayment cannot exceed the total price',
    path: ['downpayment'],
  })

// Shape a plan row for the client: package price, total paid, remaining balance,
// payment type, status, and the ledger history that belongs to this package
// (its monthly installment charges + the payments toward them). Computed, never stored.
function present(plan, rawEntries, planFreebies = []) {
  const { paid, remaining } = planTotals(plan, rawEntries)
  // Voided payments and their reversal rows don't belong in the package history.
  const allEntries = activeEntries(rawEntries)
  const planChargeIds = new Set(
    allEntries.filter((e) => e.type === 'CHARGE' && e.planId === plan.id).map((e) => e.id),
  )
  const history = allEntries
    .filter((e) => e.planId === plan.id || (e.appliesToId && planChargeIds.has(e.appliesToId)))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((e) => ({
      id: e.id,
      type: e.type,
      amount: e.amount,
      method: e.method,
      note: e.note,
      createdAt: e.createdAt,
      by: e.author?.name ?? null,
    }))

  // Next monthly adjustment date: one month after the last adjustment charge
  // (or after the plan start / creation if none yet). Only meaningful while the
  // plan is an ACTIVE installment with a balance left.
  let nextAdjustmentDate = null
  if (plan.paymentType === 'INSTALLMENT' && plan.status === 'ACTIVE' && remaining > 0) {
    const lastAdj = allEntries
      .filter((e) => e.type === 'CHARGE' && e.planId === plan.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
    const anchor = lastAdj?.createdAt || plan.startDate || plan.createdAt
    const d = new Date(anchor)
    d.setMonth(d.getMonth() + 1)
    nextAdjustmentDate = d.toISOString()
  }

  return {
    ...plan,
    freebies: planFreebies,
    paid,
    remaining: Math.max(0, remaining),
    nextAdjustmentDate,
    payments: history,
  }
}

const loadEntries = (patientId) =>
  prisma.ledgerEntry.findMany({
    where: { patientId },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { name: true } } },
  })

async function presentOne(planId, patientId) {
  const [plan, allEntries, fbMap] = await Promise.all([
    prisma.treatmentPlan.findUnique({ where: { id: planId } }),
    loadEntries(patientId),
    freebiesForPlans(prisma, [planId]),
  ])
  return present(plan, allEntries, fbMap[planId] ?? [])
}

// GET plans with per-plan paid totals, remaining balance, history, and tracked benefits
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const { patientId } = req.params
    const [plans, allEntries] = await Promise.all([
      prisma.treatmentPlan.findMany({ where: { patientId }, orderBy: { createdAt: 'desc' } }),
      loadEntries(patientId),
    ])
    const fbMap = await freebiesForPlans(prisma, plans.map((p) => p.id))
    res.json(plans.map((p) => present(p, allEntries, fbMap[p.id] ?? [])))
  }),
)

// Creating a plan writes NO up-front price charge. The package is billed as it
// goes: each monthly adjustment adds a plan-linked CHARGE, and marking that charge
// Paid is what deducts from the package. The downpayment is booked as a charge
// that is paid immediately (net-zero on the overall balance), so the plan's paid
// starts at the downpayment.
router.post(
  '/',
  validate(planSchema),
  asyncRoute(async (req, res) => {
    const { patientId } = req.params
    const { downpaymentMethod, freebies, ...input } = req.body
    const isInstallment = input.paymentType === 'INSTALLMENT'
    const downpayment = isInstallment ? Number(input.downpayment) : null
    const benefitRows = (freebies ?? []).map((f) => ({
      name: f.name.trim(),
      procedureId: f.procedureId ?? null,
      qtyIncluded: f.qtyIncluded ?? 1,
      notes: (f.notes ?? '').trim() || null,
    }))

    const plan = await prisma.$transaction(async (tx) => {
      const p = await tx.treatmentPlan.create({
        data: {
          ...input,
          patientId,
          downpayment,
          monthlyDue: isInstallment ? input.monthlyDue : null,
        },
      })
      if (benefitRows.length) {
        await tx.planFreebie.createMany({ data: benefitRows.map((b) => ({ ...b, planId: p.id })) })
      }
      if (downpayment > 0) {
        // a payment toward the package — lowers its remaining (and Total Due).
        // Gets a receipt number and a Total-Due snapshot, like any payment.
        const { nextReceiptNo } = await import('../lib/receipts.js')
        const { patientDue } = await import('../lib/balance.js')
        const balanceBefore = await patientDue(patientId, tx)
        const dp = await tx.ledgerEntry.create({
          data: {
            patientId,
            type: 'PAYMENT',
            amount: downpayment,
            method: downpaymentMethod ?? 'CASH',
            note: 'Downpayment',
            planId: p.id,
            receiptNo: await nextReceiptNo(tx),
            balanceBefore,
            createdBy: req.user.id,
          },
        })
        await tx.ledgerEntry.update({
          where: { id: dp.id },
          data: { balanceAfter: await patientDue(patientId, tx) },
        })
      }
      return p
    })

    audit({ userId: req.user.id, action: 'CREATE', entity: 'treatment_plan', entityId: plan.id })
    res.status(201).json(await presentOne(plan.id, patientId))
  }),
)

const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(PAYMENT_METHODS).optional().nullable(),
  note: z.string().optional().nullable(),
})

// Record a payment against a package. The amount cannot exceed the remaining
// balance, and the plan is marked PAID automatically once it reaches zero.
router.post(
  '/:planId/payments',
  validate(paymentSchema),
  asyncRoute(async (req, res) => {
    const { patientId, planId } = req.params
    const plan = await prisma.treatmentPlan.findUnique({ where: { id: planId } })
    if (!plan || plan.patientId !== patientId) {
      return res.status(404).json({ error: 'Plan not found' })
    }

    const { entry, status } = await prisma.$transaction((tx) =>
      recordPlanPayment(tx, {
        plan,
        patientId,
        amount: req.body.amount,
        method: req.body.method ?? 'CASH',
        note: req.body.note,
        userId: req.user.id,
      }),
    )

    audit({
      userId: req.user.id,
      action: 'CREATE',
      entity: 'ledger_entry',
      entityId: entry.id,
      detail: { type: 'PAYMENT', amount: entry.amount, planId },
    })
    if (status !== plan.status) {
      audit({ userId: req.user.id, action: 'UPDATE', entity: 'treatment_plan', entityId: planId, detail: { status } })
    }

    res.status(201).json(await presentOne(planId, patientId))
  }),
)

// Braces packages are priced per patient — name / price / schedule / freebies /
// included procedures are all editable. `remaining` is `totalPrice − Σ payments
// toward the plan`, so editing the price just re-derives the balance.
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  paymentType: z.enum(['CASH', 'INSTALLMENT']).optional(),
  totalPrice: z.coerce.number().positive().optional(),
  downpayment: z.coerce.number().nonnegative().optional().nullable(),
  monthlyDue: z.coerce.number().nonnegative().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  freebies: z.array(freebieSchema).optional().nullable(),
  includedProcedures: z.array(includedProcedureSchema).optional().nullable(),
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
})

router.patch(
  '/:planId',
  validate(updateSchema),
  asyncRoute(async (req, res) => {
    const { patientId, planId } = req.params
    const plan = await prisma.treatmentPlan.findUnique({ where: { id: planId } })
    if (!plan || plan.patientId !== patientId) {
      return res.status(404).json({ error: 'Plan not found' })
    }

    const body = req.body
    const data = {}
    for (const k of ['name', 'paymentType', 'downpayment', 'monthlyDue', 'startDate', 'notes', 'status', 'totalPrice']) {
      if (body[k] !== undefined) data[k] = body[k]
    }
    if (body.includedProcedures !== undefined) data.includedProcedures = body.includedProcedures ?? []

    // Reconcile tracked benefits (PlanFreebie rows) when `freebies` is supplied.
    let existing = []
    if (body.freebies !== undefined) {
      existing = await prisma.planFreebie.findMany({ where: { planId }, include: { entries: true } })
      const incoming = body.freebies ?? []
      const keepIds = new Set(incoming.filter((f) => f.id).map((f) => f.id))
      for (const row of existing) {
        if (keepIds.has(row.id)) continue
        if (row.entries.length > 0) {
          return res
            .status(400)
            .json({ error: `"${row.name}" has activity — void its remaining quantity instead of removing it` })
        }
      }
      for (const f of incoming) {
        if (!f.id) continue
        const row = existing.find((r) => r.id === f.id)
        if (!row) continue
        const { used, voided } = freebieTotals(row, row.entries)
        if (f.qtyIncluded < used + voided) {
          return res.status(400).json({
            error: `"${f.name}" already has ${used + voided} used/voided — quantity can't drop below that`,
          })
        }
      }
    }

    const status = await prisma.$transaction(async (tx) => {
      await tx.treatmentPlan.update({ where: { id: planId }, data })
      if (body.freebies !== undefined) {
        const incoming = body.freebies ?? []
        const keepIds = new Set(incoming.filter((f) => f.id).map((f) => f.id))
        await tx.planFreebie.deleteMany({
          where: { planId, id: { notIn: [...keepIds].length ? [...keepIds] : ['__none__'] } },
        })
        for (const f of incoming) {
          const payload = {
            name: f.name.trim(),
            procedureId: f.procedureId ?? null,
            qtyIncluded: f.qtyIncluded ?? 1,
            notes: (f.notes ?? '').trim() || null,
          }
          if (f.id && existing.some((r) => r.id === f.id)) {
            await tx.planFreebie.update({ where: { id: f.id }, data: payload })
          } else {
            await tx.planFreebie.create({ data: { ...payload, planId } })
          }
        }
      }
      return syncPlanStatus(tx, planId)
    })

    const moneyChanges = {}
    for (const k of ['totalPrice', 'downpayment', 'monthlyDue']) {
      if (data[k] !== undefined && Number(data[k]) !== Number(plan[k] ?? 0)) {
        moneyChanges[k] = { from: plan[k], to: data[k] }
      }
    }
    audit({
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'treatment_plan',
      entityId: planId,
      detail: {
        changed: [...Object.keys(data), ...(body.freebies !== undefined ? ['freebies'] : [])],
        ...(Object.keys(moneyChanges).length ? { values: moneyChanges } : {}),
      },
    })
    if (status && status !== plan.status) {
      audit({ userId: req.user.id, action: 'UPDATE', entity: 'treatment_plan', entityId: planId, detail: { status: { from: plan.status, to: status } } })
    }

    res.json(await presentOne(planId, patientId))
  }),
)

export default router
