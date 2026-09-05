import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router({ mergeParams: true })

const planSchema = z.object({
  name: z.string().min(1),
  totalPrice: z.coerce.number().positive(),
  downpayment: z.coerce.number().nonnegative().optional().nullable(),
  monthlyDue: z.coerce.number().nonnegative().optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  notes: z.string().optional().nullable(),
})

// GET plans with per-plan paid totals and remaining balance
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const plans = await prisma.treatmentPlan.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { createdAt: 'desc' },
      include: { ledgerEntries: true },
    })
    res.json(
      plans.map((plan) => {
        const paid = plan.ledgerEntries
          .filter((e) => e.type !== 'CHARGE')
          .reduce((s, e) => s + Number(e.amount), 0)
        const { ledgerEntries, ...rest } = plan
        return { ...rest, paid, remaining: Number(plan.totalPrice) - paid }
      }),
    )
  }),
)

// Creating a plan writes its full price to the ledger as ONE charge,
// linked to the plan. Payments come in later as ordinary ledger
// payments carrying the same planId.
router.post(
  '/',
  validate(planSchema),
  asyncRoute(async (req, res) => {
    const { patientId } = req.params
    const plan = await prisma.$transaction(async (tx) => {
      const p = await tx.treatmentPlan.create({ data: { ...req.body, patientId } })
      await tx.ledgerEntry.create({
        data: {
          patientId,
          type: 'CHARGE',
          amount: p.totalPrice,
          note: `Treatment plan: ${p.name}`,
          planId: p.id,
          createdBy: req.user.id,
        },
      })
      return p
    })
    audit({ userId: req.user.id, action: 'CREATE', entity: 'treatment_plan', entityId: plan.id })
    res.status(201).json(plan)
  }),
)

const statusSchema = z.object({ status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']) })

router.patch(
  '/:planId',
  validate(statusSchema),
  asyncRoute(async (req, res) => {
    const plan = await prisma.treatmentPlan.update({
      where: { id: req.params.planId },
      data: { status: req.body.status },
    })
    audit({
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'treatment_plan',
      entityId: plan.id,
      detail: { status: plan.status },
    })
    res.json(plan)
  }),
)

export default router
