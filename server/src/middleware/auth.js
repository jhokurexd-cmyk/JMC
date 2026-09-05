import { verifyAccess } from '../lib/jwt.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Not signed in' })
  try {
    const payload = verifyAccess(token)
    req.user = { id: payload.sub, role: payload.role, name: payload.name }
    next()
  } catch {
    return res.status(401).json({ error: 'Session expired' })
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'You do not have permission for this' })
  }
  next()
}
