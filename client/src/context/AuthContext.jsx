import { createContext, useContext, useEffect, useState } from 'react'
import { post, refreshSession, setAccessToken, setSessionExpiredHandler } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null))
    refreshSession()
      .then((u) => setUser(u))
      .finally(() => setLoading(false))
  }, [])

  const login = async (email, password) => {
    const data = await post('/auth/login', { email, password })
    setAccessToken(data.accessToken)
    setUser(data.user)
  }

  const logout = async () => {
    await post('/auth/logout').catch(() => {})
    setAccessToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
