import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { requireRole } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'
import { patientDue, dueMap } from '../lib/balance.js'
import { paymentOverview } from '../lib/overview.js'

const router = Router()

const basePatient = z.object({
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
  socialMedia: z
    .array(z.object({ platform: z.string().min(1), handle: z.string().min(1) }))
    .optional()
    .nullable(),
  consentSigned: z.boolean().optional(),
  force: z.boolean().optional(), // bypass the duplicate-patient guard
})

const norm = (s) => (s ?? '').trim().toLowerCase()

const notFutureBirth = {
  message: 'Birth date cannot be in the future',
  path: ['birthDate'],
}
const birthOk = (v) => !v.birthDate || v.birthDate <= new Date()
const patientSchema = basePatient.refine(birthOk, notFutureBirth)
const patientPatchSchema = basePatient.partial().refine(birthOk, notFutureBirth)

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
    const due = await dueMap(patients.map((p) => p.id))
    res.json(patients.map((p) => ({ ...p, balance: due[p.id] ?? 0 })))
  }),
)

// GET /patients/:id — full profile with balance
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id } })
    if (!patient || patient.archived) return res.status(404).json({ error: 'Patient not found' })
    res.json({ ...patient, balance: await patientDue(patient.id) })
  }),
)

// GET /patients/:id/payment-overview — read-only financial snapshot
router.get(
  '/:id/payment-overview',
  asyncRoute(async (req, res) => {
    const patient = await prisma.patient.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!patient) return res.status(404).json({ error: 'Patient not found' })
    res.json(await paymentOverview(req.params.id))
  }),
)

router.post(
  '/',
  validate(patientSchema),
  asyncRoute(async (req, res) => {
    const { consentSigned, force, ...data } = req.body

    // Duplicate guard: same first+last name and (if given) same phone.
    if (!force) {
      const candidates = await prisma.patient.findMany({
        where: {
          archived: false,
          firstName: { equals: data.firstName, mode: 'insensitive' },
          lastName: { equals: data.lastName, mode: 'insensitive' },
        },
        select: { id: true, firstName: true, lastName: true, phone: true, createdAt: true },
      })
      const phone = norm(data.phone)
      const dups = candidates.filter((c) => !phone || norm(c.phone) === phone)
      if (dups.length) {
        return res.status(409).json({
          error: `A patient named ${data.firstName} ${data.lastName}${phone ? ' with that phone' : ''} already exists.`,
          possibleDuplicates: dups.map((d) => ({
            id: d.id,
            name: [d.lastName, d.firstName].filter(Boolean).join(', '),
            phone: d.phone || null,
            createdAt: d.createdAt,
          })),
        })
      }
    }

    const patient = await prisma.patient.create({
      data: { ...data, consentSignedAt: consentSigned ? new Date() : null },
    })
    audit({
      userId: req.user.id,
      action: 'CREATE',
      entity: 'patient',
      entityId: patient.id,
      detail: { name: `${patient.lastName}, ${patient.firstName}`, phone: patient.phone ?? undefined, forced: force || undefined },
    })
    res.status(201).json(patient)
  }),
)

router.patch(
  '/:id',
  validate(patientPatchSchema),
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
    audit({
      userId: req.user.id,
      action: 'ARCHIVE',
      entity: 'patient',
      entityId: patient.id,
      detail: { name: `${patient.lastName}, ${patient.firstName}`, phone: patient.phone ?? undefined },
    })
    res.json({ ok: true })
  }),
)

export default router
