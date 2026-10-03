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
    this.data = data ?? {}
  }
}

export const get = (path) => api(path)
export const post = (path, body) => api(path, { method: 'POST', body })
export const patch = (path, body) => api(path, { method: 'PATCH', body })
export const del = (path) => api(path, { method: 'DELETE' })

// Raw binary fetch (e.g. X-ray images) with the same auth + one-retry-on-401
// flow as api(). Returns a Blob for URL.createObjectURL().
export async function getBlob(path) {
  const send = () =>
    fetch(`/api/v1${path}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
    })
  let res = await send()
  if (res.status === 401) {
    const user = await refreshSession()
    if (!user) {
      onSessionExpired()
      throw new ApiError('Session expired', 401, {})
    }
    res = await send()
  }
  if (!res.ok) throw new ApiError('Could not load file', res.status, {})
  return res.blob()
}

// Fetch `path` with auth and save it as `filename` (used for report CSV downloads).
export async function downloadFile(path, filename) {
  const blob = await getBlob(path)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Multipart upload (FormData) with the same auth + one-retry-on-401 flow.
export async function postForm(path, formData) {
  const send = () =>
    fetch(`/api/v1${path}`, {
      method: 'POST',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
      body: formData,
    })
  let res = await send()
  if (res.status === 401) {
    const user = await refreshSession()
    if (!user) {
      onSessionExpired()
      throw new ApiError('Session expired', 401, {})
    }
    res = await send()
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error ?? 'Upload failed', res.status, data)
  return data
}
