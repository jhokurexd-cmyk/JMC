import { Router } from 'express'
import argon2 from 'argon2'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { signAccess, signRefresh, verifyRefresh, refreshCookieOptions } from '../lib/jwt.js'
import { validate } from '../middleware/validate.js'
import { requireAuth } from '../middleware/auth.js'
import { asyncRoute } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

router.post(
  '/login',
  validate(loginSchema),
  asyncRoute(async (req, res) => {
    const { email, password } = req.body
    const user = await prisma.user.findUnique({ where: { email } })
    const valid = user && user.active && (await argon2.verify(user.passwordHash, password))
    if (!valid) return res.status(401).json({ error: 'Email or password is incorrect' })

    audit({ userId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id })
    res.cookie('refresh_token', signRefresh(user), refreshCookieOptions)
    res.json({
      accessToken: signAccess(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  }),
)

router.post(
  '/refresh',
  asyncRoute(async (req, res) => {
    const token = req.cookies?.refresh_token
    if (!token) return res.status(401).json({ error: 'Not signed in' })
    let payload
    try {
      payload = verifyRefresh(token)
    } catch {
      return res.status(401).json({ error: 'Session expired' })
    }
    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user || !user.active) return res.status(401).json({ error: 'Session expired' })
    res.json({
      accessToken: signAccess(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  }),
)

router.post('/logout', (req, res) => {
  res.clearCookie('refresh_token', { path: refreshCookieOptions.path })
  res.json({ ok: true })
})

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, email: true, role: true },
    })
    res.json(user)
  }),
)

export default router
