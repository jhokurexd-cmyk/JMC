import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncRoute } from '../middleware/errors.js'

const router = Router()

// Distinct "Performed by" names used on past procedures, most-used first.
// Powers the autocomplete on the visit form — free text, no user accounts.
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const rows = await prisma.visitProcedure.groupBy({
      by: ['performedBy'],
      where: { performedBy: { not: null } },
      _count: { performedBy: true },
    })
    const names = rows
      .filter((r) => r.performedBy && r.performedBy.trim())
      .sort((a, b) => b._count.performedBy - a._count.performedBy)
      .slice(0, 50)
      .map((r) => r.performedBy)
    res.json(names)
  }),
)

export default router
