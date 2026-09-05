import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { requireRole } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router()

const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  middleName: z.string().optional().nullable(),
  birthDate: z.coerce.date().optional().nullable(),
  sex: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  address: z.string().optional().nullable(),
  guardianName: z.string().optional().nullable(),
  guardianPhone: z.string().optional().nullable(),
  allergies: z.string().optional().nullable(),
  medicalNotes: z.string().optional().nullable(),
  consentSigned: z.boolean().optional(),
})

// GET /patients?search=&page=
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const search = (req.query.search ?? '').toString().trim()
    const where = {
      archived: false,
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ],
      }),
    }
    const patients = await prisma.patient.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 100,
    })
    // attach balances in one grouped query
    const balances = await prisma.ledgerEntry.groupBy({
      by: ['patientId', 'type'],
      where: { patientId: { in: patients.map((p) => p.id) } },
      _sum: { amount: true },
    })
    const balanceMap = {}
    for (const b of balances) {
      const sign = b.type === 'CHARGE' ? 1 : -1
      balanceMap[b.patientId] = (balanceMap[b.patientId] ?? 0) + sign * Number(b._sum.amount)
    }
    res.json(patients.map((p) => ({ ...p, balance: balanceMap[p.id] ?? 0 })))
  }),
)

// GET /patients/:id — full profile with balance
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id } })
    if (!patient || patient.archived) return res.status(404).json({ error: 'Patient not found' })
    const entries = await prisma.ledgerEntry.findMany({ where: { patientId: patient.id } })
    const balance = entries.reduce(
      (sum, e) => sum + (e.type === 'CHARGE' ? 1 : -1) * Number(e.amount),
      0,
    )
    res.json({ ...patient, balance })
  }),
)

router.post(
  '/',
  validate(patientSchema),
  asyncRoute(async (req, res) => {
    const { consentSigned, ...data } = req.body
    const patient = await prisma.patient.create({
      data: { ...data, consentSignedAt: consentSigned ? new Date() : null },
    })
    audit({ userId: req.user.id, action: 'CREATE', entity: 'patient', entityId: patient.id })
    res.status(201).json(patient)
  }),
)

router.patch(
  '/:id',
  validate(patientSchema.partial()),
  asyncRoute(async (req, res) => {
    const { consentSigned, ...data } = req.body
    if (consentSigned) data.consentSignedAt = new Date()
    const patient = await prisma.patient.update({ where: { id: req.params.id }, data })
    audit({
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'patient',
      entityId: patient.id,
      detail: { changed: Object.keys(data) },
    })
    res.json(patient)
  }),
)

// RA 10173: archive, never delete. Owner/dentist only.
router.delete(
  '/:id',
  requireRole('OWNER', 'DENTIST'),
  asyncRoute(async (req, res) => {
    const patient = await prisma.patient.update({
      where: { id: req.params.id },
      data: { archived: true },
    })
    audit({ userId: req.user.id, action: 'ARCHIVE', entity: 'patient', entityId: patient.id })
    res.json({ ok: true })
  }),
)

export default router
