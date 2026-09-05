// Thin API client. Keeps the access token in memory (not localStorage —
// safer against XSS); the refresh token lives in an httpOnly cookie the
// browser sends automatically. On a 401 we try one silent refresh, then
// retry the original request.

let accessToken = null
let onSessionExpired = () => {}

export const setAccessToken = (t) => { accessToken = t }
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn }

async function rawRequest(path, options = {}) {
  const headers = { ...(options.headers ?? {}) }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  return res
}

export async function refreshSession() {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' })
  if (!res.ok) return null
  const data = await res.json()
  accessToken = data.accessToken
  return data.user
}

export async function api(path, options = {}) {
  let res = await rawRequest(path, options)
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const user = await refreshSession()
    if (!user) {
      onSessionExpired()
      throw new ApiError('Session expired', 401, {})
    }
    res = await rawRequest(path, options)
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? 'Request failed', res.status, data)
  return data
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.fields = data?.fields ?? {}
  }
}

export const get = (path) => api(path)
export const post = (path, body) => api(path, { method: 'POST', body })
export const patch = (path, body) => api(path, { method: 'PATCH', body })
export const del = (path) => api(path, { method: 'DELETE' })
