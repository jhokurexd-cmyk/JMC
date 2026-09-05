import jwt from 'jsonwebtoken'

const ACCESS_TTL = '15m'
const REFRESH_TTL = '7d'

export const signAccess = (user) =>
  jwt.sign({ sub: user.id, role: user.role, name: user.name }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  })

export const signRefresh = (user) =>
  jwt.sign({ sub: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: REFRESH_TTL })

export const verifyAccess = (token) => jwt.verify(token, process.env.JWT_SECRET)
export const verifyRefresh = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET)

export const refreshCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
}
