import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { requireRole } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'
import { freebieTotals } from '../lib/freebies.js'

// Void / restore a patient's UNUSED package benefits. OWNER only.
// Consuming a benefit during a visit and marking a one-off perk claimed happen
// on the visit route and stay open to any staff. Append-only: void and restore
// each write a PlanFreebieEntry; nothing is edited or deleted.
const router = Router({ mergeParams: true })

const actionSchema = z.object({
  qty: z.coerce.number().int().min(1),
  reason: z.string().trim().min(1, 'A reason is required'),
})

async function loadFreebie(req, res) {
  const { patientId, planId, freebieId } = req.params
  const freebie = await prisma.planFreebie.findUnique({
    where: { id: freebieId },
    include: { plan: { select: { id: true, patientId: true } }, entries: true },
  })
  if (!freebie || freebie.planId !== planId || freebie.plan.patientId !== patientId) {
    res.status(404).json({ error: 'Benefit not found' })
    return null
  }
  return freebie
}

router.post(
  '/:freebieId/void',
  requireRole('OWNER'),
  validate(actionSchema),
  asyncRoute(async (req, res) => {
    const freebie = await loadFreebie(req, res)
    if (!freebie) return
    const { remaining } = freebieTotals(freebie, freebie.entries)
    if (req.body.qty > remaining) {
      return res.status(400).json({ error: `Only ${remaining} left to void` })
    }
    const entry = await prisma.planFreebieEntry.create({
      data: {
        freebieId: freebie.id,
        type: 'VOID',
        qty: req.body.qty,
        reason: req.body.reason,
        createdBy: req.user.id,
      },
    })
    audit({
      userId: req.user.id,
      action: 'VOID',
      entity: 'plan_freebie',
      entityId: freebie.id,
      detail: { name: freebie.name, qty: req.body.qty, reason: req.body.reason, planId: freebie.planId },
    })
    res.status(201).json(entry)
  }),
)

router.post(
  '/:freebieId/restore',
  requireRole('OWNER'),
  validate(actionSchema),
  asyncRoute(async (req, res) => {
    const freebie = await loadFreebie(req, res)
    if (!freebie) return
    const { voided } = freebieTotals(freebie, freebie.entries)
    if (req.body.qty > voided) {
      return res.status(400).json({ error: `Only ${voided} voided quantity can be restored` })
    }
    const entry = await prisma.planFreebieEntry.create({
      data: {
        freebieId: freebie.id,
        type: 'RESTORE',
        qty: req.body.qty,
        reason: req.body.reason,
        createdBy: req.user.id,
      },
    })
    audit({
      userId: req.user.id,
      action: 'RESTORE',
      entity: 'plan_freebie',
      entityId: freebie.id,
      detail: { name: freebie.name, qty: req.body.qty, reason: req.body.reason, planId: freebie.planId },
    })
    res.status(201).json(entry)
  }),
)

export default router
