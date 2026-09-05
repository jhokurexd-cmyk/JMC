import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router()

const appointmentSchema = z.object({
  patientId: z.string().uuid().optional().nullable(),
  patientName: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  note: z.string().optional().nullable(),
  status: z
    .enum(['SCHEDULED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .optional(),
})

// GET /appointments?from=ISO&to=ISO
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const { from, to } = req.query
    const where = {}
    if (from || to) {
      where.startsAt = {}
      if (from) where.startsAt.gte = new Date(from)
      if (to) where.startsAt.lte = new Date(to)
    }
    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { startsAt: 'asc' },
    })
    res.json(appointments)
  }),
)

router.post(
  '/',
  validate(appointmentSchema),
  asyncRoute(async (req, res) => {
    // conflict warning: overlapping non-cancelled appointment
    const overlap = await prisma.appointment.findFirst({
      where: {
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startsAt: { lt: req.body.endsAt },
        endsAt: { gt: req.body.startsAt },
      },
    })
    const appointment = await prisma.appointment.create({ data: req.body })
    audit({ userId: req.user.id, action: 'CREATE', entity: 'appointment', entityId: appointment.id })
    res.status(201).json({ ...appointment, conflict: Boolean(overlap) })
  }),
)

router.patch(
  '/:id',
  validate(appointmentSchema.partial()),
  asyncRoute(async (req, res) => {
    const appointment = await prisma.appointment.update({
      where: { id: req.params.id },
      data: req.body,
    })
    audit({ userId: req.user.id, action: 'UPDATE', entity: 'appointment', entityId: appointment.id })
    res.json(appointment)
  }),
)

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    // appointments are operational, not clinical — hard delete is acceptable,
    // but we keep the audit trail of the deletion.
    await prisma.appointment.delete({ where: { id: req.params.id } })
    audit({ userId: req.user.id, action: 'DELETE', entity: 'appointment', entityId: req.params.id })
    res.json({ ok: true })
  }),
)

export default router
