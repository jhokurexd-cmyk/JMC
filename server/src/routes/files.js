import { Router } from 'express'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import multer from 'multer'
import { prisma } from '../lib/prisma.js'
import { asyncRoute, HttpError } from '../middleware/errors.js'
import { requireRole } from '../middleware/auth.js'
import { audit } from '../lib/audit.js'

const router = Router({ mergeParams: true })

// Binaries live on disk (gitignored); patient_files rows hold the metadata.
const UPLOAD_DIR = path.join(import.meta.dirname, '..', '..', 'uploads', 'xrays')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf' }

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + (EXT[file.mimetype] ?? '')),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (EXT[file.mimetype]) return cb(null, true)
    cb(new HttpError(400, 'Only PNG, JPEG, WebP or PDF files are allowed'))
  },
})

const metaSchema = z.object({
  label: z.string().max(200).optional().nullable(),
  kind: z.string().max(40).optional(),
  xrayType: z.string().max(40).optional().nullable(),
  description: z.string().max(1000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  takenAt: z.coerce.date().optional().nullable(),
})
const clean = (o) => Object.fromEntries(
  Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === '' ? null : v]),
)

// GET /patients/:patientId/files
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const files = await prisma.patientFile.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(files)
  }),
)

// POST /patients/:patientId/files   (multipart/form-data, field "file")
router.post(
  '/',
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'No file uploaded')
    const parsed = metaSchema.safeParse(req.body)
    const m = parsed.success ? parsed.data : {}
    const row = await prisma.patientFile.create({
      data: {
        patientId: req.params.patientId,
        kind: m.kind || 'XRAY',
        label: m.label || null,
        xrayType: m.xrayType || null,
        description: m.description || null,
        notes: m.notes || null,
        takenAt: m.takenAt || null,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadedBy: req.user.id,
      },
    })
    audit({
      userId: req.user.id,
      action: 'CREATE',
      entity: 'patient_file',
      entityId: row.id,
      detail: { kind: row.kind, xrayType: row.xrayType ?? undefined, label: row.label ?? undefined, size: row.size, patientId: req.params.patientId },
    })
    res.status(201).json(row)
  }),
)

// GET /patients/:patientId/files/:fileId/raw  — stream the binary
router.get(
  '/:fileId/raw',
  asyncRoute(async (req, res) => {
    const row = await prisma.patientFile.findUnique({ where: { id: req.params.fileId } })
    if (!row || row.patientId !== req.params.patientId) {
      return res.status(404).json({ error: 'File not found' })
    }
    const abs = path.join(UPLOAD_DIR, row.filename)
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' })
    res.type(row.mimeType)
    res.sendFile(abs)
  }),
)

// PATCH /patients/:patientId/files/:fileId  — edit metadata (not the binary)
router.patch(
  '/:fileId',
  asyncRoute(async (req, res) => {
    const existing = await prisma.patientFile.findUnique({ where: { id: req.params.fileId } })
    if (!existing || existing.patientId !== req.params.patientId) {
      return res.status(404).json({ error: 'File not found' })
    }
    const parsed = metaSchema.partial().safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid input', fields: parsed.error.flatten().fieldErrors })
    const data = clean({
      label: parsed.data.label,
      xrayType: parsed.data.xrayType,
      description: parsed.data.description,
      notes: parsed.data.notes,
      takenAt: parsed.data.takenAt,
    })
    const row = await prisma.patientFile.update({ where: { id: existing.id }, data })
    audit({
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'patient_file',
      entityId: row.id,
      detail: { changed: Object.keys(data), patientId: req.params.patientId },
    })
    res.json(row)
  }),
)

// DELETE /patients/:patientId/files/:fileId  — clinical record, OWNER/DENTIST only
router.delete(
  '/:fileId',
  requireRole('OWNER', 'DENTIST'),
  asyncRoute(async (req, res) => {
    const row = await prisma.patientFile.findUnique({ where: { id: req.params.fileId } })
    if (!row || row.patientId !== req.params.patientId) {
      return res.status(404).json({ error: 'File not found' })
    }
    fs.rm(path.join(UPLOAD_DIR, row.filename), { force: true }, () => {})
    await prisma.patientFile.delete({ where: { id: row.id } })
    audit({
      userId: req.user.id,
      action: 'DELETE',
      entity: 'patient_file',
      entityId: row.id,
      detail: { label: row.label ?? undefined, kind: row.kind, originalName: row.originalName, patientId: row.patientId },
    })
    res.json({ ok: true })
  }),
)

export default router
