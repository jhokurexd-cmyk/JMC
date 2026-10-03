import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute, HttpError } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'
import { planRemaining } from '../lib/plans.js'
import { freebieRemaining } from '../lib/freebies.js'

const router = Router({ mergeParams: true })

const cents = (n) => Math.round(Number(n) * 100)
const peso = (n) => '₱' + Number(n).toLocaleString('en-PH')
const endOfToday = () => {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)

// A visit records what was done. Procedure prices land in the ledger as charges;
// payments are recorded afterward on the Ledger & payments tab.
//
// - A "Monthly Braces Adjustment" line tied to a package (`coveredByPlanId`) is
//   charged like any procedure — marking that charge Paid deducts from the package.
// - A quantity procedure (Filling ×3) sends `items: [{ price, covered }]`. Items
//   ticked `covered` are paid by a package benefit (`coveredByFreebieId`) — they
//   are NOT charged and they never touch the package's money balance; each one
//   writes a PlanFreebieEntry USE.
// - `coveredByPlanId` and `coveredByFreebieId` are mutually exclusive on a line.
const itemSchema = z.object({
  price: z.coerce.number().nonnegative(),
  covered: z.boolean().default(false),
})
const visitSchema = z
  .object({
    visitDate: z.coerce.date(),
    notes: z.string().optional().nullable(),
    nextVisitDate: z.coerce.date().optional().nullable(),
    dentistId: z.string().uuid().optional().nullable(),
    appointmentId: z.string().uuid().optional().nullable(),
    procedures: z
      .array(
        z.object({
          procedureId: z.string().uuid(),
          priceCharged: z.coerce.number().nonnegative().default(0),
          quantity: z.coerce.number().int().min(1).default(1),
          items: z.array(itemSchema).optional(),
          coveredByPlanId: z.string().uuid().optional().nullable(),
          coveredByFreebieId: z.string().uuid().optional().nullable(),
          performedBy: z.string().trim().max(120).optional().nullable(),
        }),
      )
      .default([]),
    chargeToLedger: z.boolean().default(true),
  })
  .refine((v) => v.visitDate <= endOfToday(), {
    message: 'Visit date cannot be in the future',
    path: ['visitDate'],
  })
  .refine((v) => !v.nextVisitDate || v.nextVisitDate >= v.visitDate, {
    message: 'Next visit date must be on or after the visit date',
    path: ['nextVisitDate'],
  })

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const visits = await prisma.visit.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { visitDate: 'desc' },
      include: {
        procedures: {
          include: {
            procedure: { select: { name: true } },
            coveredByPlan: { select: { name: true } },
            coveredByFreebie: { select: { name: true } },
          },
        },
        dentist: { select: { name: true } },
      },
    })
    res.json(visits)
  }),
)

router.post(
  '/',
  validate(visitSchema),
  asyncRoute(async (req, res) => {
    const { patientId } = req.params
    const { procedures, chargeToLedger, appointmentId, ...data } = req.body

    const activePlanIds = new Set(
      (
        await prisma.treatmentPlan.findMany({
          where: { patientId, status: 'ACTIVE' },
          select: { id: true },
        })
      ).map((p) => p.id),
    )
    const procNames = Object.fromEntries(
      (
        await prisma.procedure.findMany({
          where: { id: { in: [...new Set(procedures.map((p) => p.procedureId))] } },
          select: { id: true, name: true },
        })
      ).map((p) => [p.id, p.name]),
    )

    // Resolve each line: items, covered count, billable total, and the freebie.
    const computed = []
    for (const p of procedures) {
      const items = (p.items && p.items.length
        ? p.items
        : [{ price: p.priceCharged, covered: false }]
      ).map((i) => ({ price: Number(i.price) || 0, covered: Boolean(i.covered) }))
      const coveredCount = items.filter((i) => i.covered).length
      const billable = sum(items.filter((i) => !i.covered), (i) => i.price)

      if (p.coveredByPlanId && p.coveredByFreebieId) {
        throw new HttpError(400, 'A line cannot be both a package adjustment and a covered benefit')
      }

      // Monthly Braces Adjustment charged to the package.
      if (p.coveredByPlanId) {
        if (!/adjustment/i.test(procNames[p.procedureId] ?? '')) {
          throw new HttpError(400, 'Only a Braces Adjustment can be charged to a package')
        }
        if (!activePlanIds.has(p.coveredByPlanId)) {
          throw new HttpError(400, 'That package is not active for this patient')
        }
        const { remaining } = (await planRemaining(prisma, p.coveredByPlanId)) ?? {}
        if (remaining != null && cents(billable) > cents(remaining)) {
          throw new HttpError(
            400,
            `Adjustment ${peso(billable)} is more than the ${peso(Math.max(0, remaining))} left on this package`,
          )
        }
      }

      // Items covered by a package benefit (e.g. Free Fillings).
      let freebieName = null
      if (coveredCount > 0) {
        if (!p.coveredByFreebieId) {
          throw new HttpError(400, 'Pick which package benefit covers the free items')
        }
        const fb = await freebieRemaining(prisma, p.coveredByFreebieId)
        if (!fb || fb.freebie.plan.patientId !== patientId || fb.freebie.plan.status !== 'ACTIVE') {
          throw new HttpError(400, 'That package benefit is not available for this patient')
        }
        if (fb.freebie.procedureId !== p.procedureId) {
          throw new HttpError(400, `"${fb.freebie.name}" does not apply to ${procNames[p.procedureId] ?? 'that procedure'}`)
        }
        if (coveredCount > fb.remaining) {
          throw new HttpError(400, `Only ${fb.remaining} free ${fb.freebie.name} left`)
        }
        freebieName = fb.freebie.name
      }

      computed.push({
        procedureId: p.procedureId,
        performedBy: p.performedBy?.trim() || null,
        coveredByPlanId: p.coveredByPlanId ?? null,
        coveredByFreebieId: coveredCount > 0 ? p.coveredByFreebieId : null,
        items,
        quantity: items.length,
        coveredCount,
        billable,
        freebieName,
        name: procNames[p.procedureId] ?? 'Procedure',
      })
    }

    // Optional: this visit fulfils an appointment. It must belong to this patient.
    let appointment = null
    if (appointmentId) {
      appointment = await prisma.appointment.findUnique({ where: { id: appointmentId } })
      if (!appointment || appointment.patientId !== patientId) {
        throw new HttpError(400, 'That appointment does not belong to this patient')
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const v = await tx.visit.create({
        data: {
          ...data,
          patientId,
          appointmentId: appointment?.id ?? null,
          procedures: {
            create: computed.map((c) => ({
              procedureId: c.procedureId,
              priceCharged: c.billable,
              quantity: c.quantity,
              items: c.items,
              coveredByPlanId: c.coveredByPlanId,
              coveredByFreebieId: c.coveredByFreebieId,
              performedBy: c.performedBy,
            })),
          },
        },
        include: { procedures: true },
      })

      for (let i = 0; i < v.procedures.length; i++) {
        const vp = v.procedures[i]
        const c = computed[i]

        if (chargeToLedger && cents(c.billable) > 0) {
          const qtyPart = c.quantity > 1 ? ` ×${c.quantity}` : ''
          const freePart = c.coveredCount > 0 ? ` — ${c.coveredCount} free` : ''
          let note = `${c.name}${qtyPart}${freePart}`
          if (c.performedBy) note += ` · ${c.performedBy}`
          await tx.ledgerEntry.create({
            data: {
              patientId,
              type: 'CHARGE',
              amount: c.billable,
              note,
              planId: c.coveredByPlanId,
              visitProcedureId: vp.id,
              createdBy: req.user.id,
            },
          })
        }

        if (c.coveredCount > 0) {
          await tx.planFreebieEntry.create({
            data: {
              freebieId: c.coveredByFreebieId,
              type: 'USE',
              qty: c.coveredCount,
              visitProcedureId: vp.id,
              createdBy: req.user.id,
            },
          })
        }
      }

      // Recording the visit closes out its appointment.
      if (appointment && !['COMPLETED', 'CANCELLED'].includes(appointment.status)) {
        await tx.appointment.update({ where: { id: appointment.id }, data: { status: 'COMPLETED' } })
      }

      return v
    })

    audit({
      userId: req.user.id,
      action: 'CREATE',
      entity: 'visit',
      entityId: created.id,
      detail: {
        patientId,
        visitDate: data.visitDate,
        procedures: computed.map((c) => ({
          name: c.name,
          qty: c.quantity,
          charge: c.billable,
          free: c.coveredCount || undefined,
          adjustment: c.coveredByPlanId ? true : undefined,
          performedBy: c.performedBy || undefined,
        })),
        total: computed.reduce((s, c) => s + c.billable, 0),
      },
    })
    for (const c of computed) {
      if (c.coveredCount > 0) {
        audit({
          userId: req.user.id,
          action: 'USE',
          entity: 'plan_freebie',
          entityId: c.coveredByFreebieId,
          detail: { name: c.freebieName, qty: c.coveredCount, visitId: created.id },
        })
      }
    }
    if (appointment && !['COMPLETED', 'CANCELLED'].includes(appointment.status)) {
      audit({
        userId: req.user.id,
        action: 'UPDATE',
        entity: 'appointment',
        entityId: appointment.id,
        detail: { status: 'COMPLETED', via: 'visit', visitId: created.id },
      })
    }
    res.status(201).json(created)
  }),
)

export default router
