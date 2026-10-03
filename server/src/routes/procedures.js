import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { requireRole } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router()

const procedureSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  defaultPrice: z.coerce.number().nonnegative(),
  // "Allow Quantity / Multiple Items" — lets a visit record N of this procedure
  // with per-item variable pricing (e.g. Filling). Off ⇒ normal single line.
  allowQuantity: z.boolean().optional(),
})

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const procedures = await prisma.procedure.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    })
    res.json(procedures)
  }),
)

router.post(
  '/',
  requireRole('OWNER', 'DENTIST'),
  validate(procedureSchema),
  asyncRoute(async (req, res) => {
    const procedure = await prisma.procedure.create({ data: req.body })
    audit({ userId: req.user.id, action: 'CREATE', entity: 'procedure', entityId: procedure.id })
    res.status(201).json(procedure)
  }),
)

router.patch(
  '/:id',
  requireRole('OWNER', 'DENTIST'),
  validate(procedureSchema.partial()),
  asyncRoute(async (req, res) => {
    const before = await prisma.procedure.findUnique({ where: { id: req.params.id } })
    if (!before) return res.status(404).json({ error: 'Procedure not found' })
    const procedure = await prisma.procedure.update({ where: { id: req.params.id }, data: req.body })
    const priceChanged =
      req.body.defaultPrice !== undefined && Number(req.body.defaultPrice) !== Number(before.defaultPrice)
    audit({
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'procedure',
      entityId: procedure.id,
      detail: {
        changed: Object.keys(req.body),
        ...(priceChanged ? { defaultPrice: { from: before.defaultPrice, to: procedure.defaultPrice } } : {}),
      },
    })
    res.json(procedure)
  }),
)

// "Delete" = deactivate; past visits keep referencing it safely.
router.delete(
  '/:id',
  requireRole('OWNER', 'DENTIST'),
  asyncRoute(async (req, res) => {
    await prisma.procedure.update({ where: { id: req.params.id }, data: { active: false } })
    audit({ userId: req.user.id, action: 'DELETE', entity: 'procedure', entityId: req.params.id })
    res.json({ ok: true })
  }),
)

export default router
