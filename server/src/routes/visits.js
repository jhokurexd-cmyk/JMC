import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router({ mergeParams: true })

const visitSchema = z.object({
  visitDate: z.coerce.date(),
  notes: z.string().optional().nullable(),
  nextVisitDate: z.coerce.date().optional().nullable(),
  dentistId: z.string().uuid().optional().nullable(),
  procedures: z
    .array(
      z.object({
        procedureId: z.string().uuid(),
        toothNumber: z.string().optional().nullable(),
        priceCharged: z.coerce.number().nonnegative(),
      }),
    )
    .default([]),
  // when true, each procedure's price is written to the ledger as a charge
  chargeToLedger: z.boolean().default(true),
})

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const visits = await prisma.visit.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { visitDate: 'desc' },
      include: {
        procedures: { include: { procedure: { select: { name: true } } } },
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
    const { procedures, chargeToLedger, ...data } = req.body

    // one transaction: the visit, its procedures, and the charges succeed or fail together
    const visit = await prisma.$transaction(async (tx) => {
      const v = await tx.visit.create({
        data: {
          ...data,
          patientId,
          procedures: {
            create: procedures.map((p) => ({
              procedureId: p.procedureId,
              toothNumber: p.toothNumber ?? null,
              priceCharged: p.priceCharged,
            })),
          },
        },
        include: { procedures: { include: { procedure: { select: { name: true } } } } },
      })
      if (chargeToLedger) {
        for (const p of v.procedures) {
          await tx.ledgerEntry.create({
            data: {
              patientId,
              type: 'CHARGE',
              amount: p.priceCharged,
              note: `${p.procedure.name}${p.toothNumber ? ` (tooth ${p.toothNumber})` : ''}`,
              createdBy: req.user.id,
            },
          })
        }
      }
      return v
    })

    audit({ userId: req.user.id, action: 'CREATE', entity: 'visit', entityId: visit.id })
    res.status(201).json(visit)
  }),
)

export default router
