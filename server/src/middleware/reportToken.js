import crypto from 'node:crypto'

// Guards the public report feed. Set REPORT_TOKEN in the environment to enable it;
// a spreadsheet passes it as ?token=… (or an X-Report-Token header). It grants
// read-only access to report CSVs only — nothing else in the API.
export function requireReportToken(req, res, next) {
  const expected = process.env.REPORT_TOKEN
  if (!expected) {
    return res.status(503).json({ error: 'Report feed not configured (set REPORT_TOKEN)' })
  }
  const got = req.query.token || req.get('x-report-token') || ''
  const a = Buffer.from(String(got))
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: 'Invalid report token' })
  }
  next()
}
