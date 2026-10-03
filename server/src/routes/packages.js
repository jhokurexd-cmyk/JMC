import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { requireRole } from '../middleware/auth.js'
import { asyncRoute, HttpError } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router()

// Template benefit / freebie: name, optional linked procedure (so a patient plan
// created from this template gets a consumable benefit for that procedure), and
// the quantity included. Stored as JSON on the template; copied into PlanFreebie
// rows when a plan is created from it.
const freebieSchema = z.object({
  name: z.string().min(1),
  procedureId: z.string().uuid().optional().nullable(),
  qtyIncluded: z.coerce.number().int().min(1).default(1),
  notes: z.string().optional().nullable(),
})

const packageSchema = z.object({
  name: z.string().min(1),
  paymentType: z.enum(['CASH', 'INSTALLMENT']).default('INSTALLMENT'),
  defaultPrice: z.coerce.number().nonnegative(),
  downpayment: z.coerce.number().nonnegative().optional().nullable(),
  monthlyDue: z.coerce.number().nonnegative().optional().nullable(),
  freebies: z.array(freebieSchema).optional().nullable(),
  notes: z.string().optional().nullable(),
  procedureIds: z.array(z.string().uuid()).default([]),
})

function present(t) {
  const { procedures, ...rest } = t
  return {
    ...rest,
    procedures: procedures.map((p) => ({
      procedureId: p.procedureId,
      name: p.procedure.name,
      category: p.procedure.category,
      defaultPrice: p.procedure.defaultPrice,
    })),
  }
}

const withProcedures = {
  include: {
    procedures: {
      include: { procedure: { select: { name: true, category: true, defaultPrice: true } } },
    },
  },
}

async function assertProceduresExist(ids) {
  if (ids.length === 0) return
  const found = await prisma.procedure.count({ where: { id: { in: ids }, active: true } })
  if (found !== new Set(ids).size) throw new HttpError(400, 'One or more procedures were not found')
}

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const templates = await prisma.packageTemplate.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      ...withProcedures,
    })
    res.json(templates.map(present))
  }),
)

router.post(
  '/',
  requireRole('OWNER', 'DENTIST'),
  validate(packageSchema),
  asyncRoute(async (req, res) => {
    const { procedureIds, ...data } = req.body
    await assertProceduresExist(procedureIds)
    const template = await prisma.$transaction(async (tx) => {
      const t = await tx.packageTemplate.create({ data })
      if (procedureIds.length) {
        await tx.packageProcedure.createMany({
          data: procedureIds.map((procedureId) => ({ templateId: t.id, procedureId })),
        })
      }
      return tx.packageTemplate.findUnique({ where: { id: t.id }, ...withProcedures })
    })
    audit({ userId: req.user.id, action: 'CREATE', entity: 'package_template', entityId: template.id })
    res.status(201).json(present(template))
  }),
)

router.patch(
  '/:id',
  requireRole('OWNER', 'DENTIST'),
  validate(packageSchema.partial()),
  asyncRoute(async (req, res) => {
    const { procedureIds, ...data } = req.body
    if (procedureIds) await assertProceduresExist(procedureIds)
    const before = await prisma.packageTemplate.findUnique({ where: { id: req.params.id } })
    if (!before) return res.status(404).json({ error: 'Package not found' })
    const template = await prisma.$transaction(async (tx) => {
      await tx.packageTemplate.update({ where: { id: req.params.id }, data })
      if (procedureIds) {
        await tx.packageProcedure.deleteMany({ where: { templateId: req.params.id } })
        if (procedureIds.length) {
          await tx.packageProcedure.createMany({
            data: procedureIds.map((procedureId) => ({ templateId: req.params.id, procedureId })),
          })
        }
      }
      return tx.packageTemplate.findUnique({ where: { id: req.params.id }, ...withProcedures })
    })
    const priceChanged =
      data.defaultPrice !== undefined && Number(data.defaultPrice) !== Number(before.defaultPrice)
    audit({
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'package_template',
      entityId: req.params.id,
      detail: {
        changed: Object.keys(data),
        procedures: procedureIds ? procedureIds.length : undefined,
        ...(priceChanged ? { defaultPrice: { from: before.defaultPrice, to: template.defaultPrice } } : {}),
      },
    })
    res.json(present(template))
  }),
)

// "Delete" = deactivate; plans already created from it keep their snapshot.
router.delete(
  '/:id',
  requireRole('OWNER', 'DENTIST'),
  asyncRoute(async (req, res) => {
    await prisma.packageTemplate.update({ where: { id: req.params.id }, data: { active: false } })
    audit({ userId: req.user.id, action: 'DELETE', entity: 'package_template', entityId: req.params.id })
    res.json({ ok: true })
  }),
)

export default router
