import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

// The ledger is APPEND-ONLY. There is deliberately no PATCH or DELETE here.
// A wrong entry is fixed by adding a correcting entry (e.g. a DISCOUNT or
// an offsetting CHARGE) so the financial history stays auditable.
const router = Router({ mergeParams: true })

const entrySchema = z.object({
  type: z.enum(['CHARGE', 'PAYMENT', 'DISCOUNT']),
  amount: z.coerce.number().positive(),
  method: z.enum(['CASH', 'GCASH', 'BANK_TRANSFER', 'CARD', 'HMO', 'OTHER']).optional().nullable(),
  note: z.string().optional().nullable(),
  planId: z.string().uuid().optional().nullable(),
})

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { name: true } },
        plan: { select: { name: true } },
      },
    })
    const balance = entries.reduce(
      (sum, e) => sum + (e.type === 'CHARGE' ? 1 : -1) * Number(e.amount),
      0,
    )
    res.json({ balance, entries })
  }),
)

router.post(
  '/',
  validate(entrySchema),
  asyncRoute(async (req, res) => {
    const entry = await prisma.ledgerEntry.create({
      data: { ...req.body, patientId: req.params.patientId, createdBy: req.user.id },
    })
    audit({
      userId: req.user.id,
      action: 'CREATE',
      entity: 'ledger_entry',
      entityId: entry.id,
      detail: { type: entry.type, amount: entry.amount },
    })
    res.status(201).json(entry)
  }),
)

export default router
