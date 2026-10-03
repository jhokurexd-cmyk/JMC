import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router()

const STATUSES = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_CHAIR', 'COMPLETED', 'CANCELLED', 'NO_SHOW']

const baseAppointment = z.object({
  patientId: z.string().uuid().optional().nullable(),
  patientName: z.string().min(1),
  dentist: z.string().trim().max(120).optional().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  note: z.string().optional().nullable(),
  status: z.enum(STATUSES).optional(),
})

const endsAfterStart = { message: 'End time must be after the start time', path: ['endsAt'] }
const appointmentSchema = baseAppointment.refine((v) => v.endsAt > v.startsAt, endsAfterStart)
const appointmentPatchSchema = baseAppointment
  .partial()
  .refine((v) => !(v.startsAt && v.endsAt) || v.endsAt > v.startsAt, endsAfterStart)

// Advisory conflict info for a proposed slot — never blocks the write.
async function conflictInfo({ startsAt, endsAt, dentist }, excludeId) {
  if (!startsAt || !endsAt) return { conflict: false, conflictSameDentist: false }
  const overlaps = await prisma.appointment.findMany({
    where: {
      archived: false,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { startsAt: 'asc' },
  })
  if (overlaps.length === 0) return { conflict: false, conflictSameDentist: false }
  const same = dentist ? overlaps.find((a) => (a.dentist || '') === dentist) : null
  const hit = same || overlaps[0]
  return {
    conflict: true,
    conflictSameDentist: Boolean(same),
    conflictWith: {
      patientName: hit.patientName,
      startsAt: hit.startsAt,
      endsAt: hit.endsAt,
      dentist: hit.dentist || null,
    },
  }
}

const auditDetail = (a) => ({
  patientName: a.patientName,
  startsAt: a.startsAt,
  status: a.status,
  dentist: a.dentist || undefined,
})

// GET /appointments?from=ISO&to=ISO
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const { from, to } = req.query
    const where = { archived: false }
    if (from || to) {
      where.startsAt = {}
      if (from) where.startsAt.gte = new Date(from)
      if (to) where.startsAt.lte = new Date(to)
    }
    const appointments = await prisma.appointment.findMany({ where, orderBy: { startsAt: 'asc' } })
    res.json(appointments)
  }),
)

router.post(
  '/',
  validate(appointmentSchema),
  asyncRoute(async (req, res) => {
    const info = await conflictInfo(req.body)
    const appointment = await prisma.appointment.create({ data: req.body })
    audit({ userId: req.user.id, action: 'CREATE', entity: 'appointment', entityId: appointment.id, detail: auditDetail(appointment) })
    res.status(201).json({ ...appointment, ...info })
  }),
)

router.patch(
  '/:id',
  validate(appointmentPatchSchema),
  asyncRoute(async (req, res) => {
    const existing = await prisma.appointment.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Appointment not found' })
    const info = await conflictInfo(
      {
        startsAt: req.body.startsAt ?? existing.startsAt,
        endsAt: req.body.endsAt ?? existing.endsAt,
        dentist: req.body.dentist ?? existing.dentist,
      },
      existing.id,
    )
    const appointment = await prisma.appointment.update({ where: { id: req.params.id }, data: req.body })
    audit({
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'appointment',
      entityId: appointment.id,
      detail: { ...auditDetail(appointment), changed: Object.keys(req.body) },
    })
    res.json({ ...appointment, ...info })
  }),
)

router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    // "Delete" = archive. Prefer setting status to Cancelled; this hides the row
    // from the calendar but keeps it (and its audit trail) on file.
    const existing = await prisma.appointment.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Appointment not found' })
    await prisma.appointment.update({ where: { id: req.params.id }, data: { archived: true } })
    audit({
      userId: req.user.id,
      action: 'ARCHIVE',
      entity: 'appointment',
      entityId: req.params.id,
      detail: auditDetail(existing),
    })
    res.json({ ok: true })
  }),
)

export default router
