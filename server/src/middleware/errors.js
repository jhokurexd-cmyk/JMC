export function errorHandler(err, req, res, next) {
  console.error(err)
  if (res.headersSent) return next(err)
  if (err.code === 'P2002') return res.status(409).json({ error: 'That record already exists' })
  if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' })
  res.status(500).json({ error: 'Something went wrong on the server' })
}

export const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next)
