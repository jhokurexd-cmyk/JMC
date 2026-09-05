import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { requireRole } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'

const router = Router()

const procedureSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  defaultPrice: z.coerce.number().nonnegative(),
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
    res.status(201).json(procedure)
  }),
)

router.patch(
  '/:id',
  requireRole('OWNER', 'DENTIST'),
  validate(procedureSchema.partial()),
  asyncRoute(async (req, res) => {
    const procedure = await prisma.procedure.update({
      where: { id: req.params.id },
      data: req.body,
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
    res.json({ ok: true })
  }),
)

export default router
