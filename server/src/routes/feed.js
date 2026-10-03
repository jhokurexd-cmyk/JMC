import { Router } from 'express'
import { asyncRoute } from '../middleware/errors.js'
import { requireReportToken } from '../middleware/reportToken.js'
import { REPORTS } from '../lib/reports.js'
import { sendCsv } from '../lib/csv.js'

// Public, token-gated report feed for Google Sheets (IMPORTDATA) / Excel
// (Data → From Web). CSV only, served inline. Mounted BEFORE requireAuth.
const router = Router()

router.use(requireReportToken)

router.get(
  '/:report.csv',
  asyncRoute(async (req, res) => {
    const build = REPORTS[req.params.report]
    if (!build) return res.status(404).json({ error: 'Unknown report' })
    sendCsv(res, await build(req.query), { attachment: false })
  }),
)

export default router
