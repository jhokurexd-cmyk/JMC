import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { asyncRoute } from '../middleware/errors.js'
import { requireRole } from '../middleware/auth.js'

// Read-only activity log. OWNER only — it exposes who did what across the clinic.
const router = Router()

const querySchema = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  action: z.string().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

router.get(
  '/',
  requireRole('OWNER'),
  asyncRoute(async (req, res) => {
    const q = querySchema.parse(req.query)
    const where = {}
    if (q.entity) where.entity = q.entity
    if (q.entityId) where.entityId = q.entityId
    if (q.action) where.action = q.action
    if (q.from || q.to) {
      where.createdAt = {}
      if (q.from) where.createdAt.gte = q.from
      if (q.to) where.createdAt.lte = q.to
    }
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: { user: { select: { name: true } } },
    })
    res.json(rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      user: r.user?.name ?? null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      detail: r.detail ?? null,
    })))
  }),
)

export default router
