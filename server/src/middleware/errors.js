// Throw this from a route or helper (including inside a transaction) to return
// a specific 4xx instead of a generic 500.
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function errorHandler(err, req, res, next) {
  console.error(err)
  if (res.headersSent) return next(err)
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  if (err.name === 'MulterError') {
    return res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 15 MB)' : err.message,
    })
  }
  if (err.code === 'P2002') return res.status(409).json({ error: 'That record already exists' })
  if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' })
  res.status(500).json({ error: 'Something went wrong on the server' })
}

export const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next)
