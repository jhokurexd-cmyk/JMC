import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/Icon'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const from = location.state?.from
  const dest = from ? `${from.pathname}${from.search ?? ''}` : '/'

  if (user) return <Navigate to={dest} replace />

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(email, password)
      navigate(dest, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-block">
          <Icon name="tooth" className="tooth" />
          <div className="name">J.M.C</div>
          <div className="tag">DENTAL CLINIC</div>
        </div>
        <h1>Welcome Back</h1>
        <p className="sub">Sign in to your clinic management system</p>
        <div className="field">
          <label htmlFor="email">Email Address</label>
          <div className="input-icon">
            <Icon name="mail" />
            <input id="email" type="email" autoComplete="username" autoFocus required value={email}
              placeholder="Enter your email" onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="input-icon">
            <Icon name="lock" />
            <input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" required
              value={password} placeholder="Enter your password" onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="trail" onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}>
              <Icon name={showPw ? 'eyeOff' : 'eye'} />
            </button>
          </div>
        </div>
        {error && <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>}
        <button className="btn" type="submit" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  )
}
