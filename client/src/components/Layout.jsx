import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from './Icon'
import PatientSearch from './PatientSearch'
import Brand from './Brand'

const links = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/appointments', label: 'Appointments', icon: 'calendar' },
  { to: '/patients', label: 'Patients', icon: 'users' },
  { to: '/procedures', label: 'Procedures & Packages', icon: 'records' },
  { to: '/income', label: 'Billing & Income', icon: 'receipt' },
  { to: '/reports', label: 'Reports', icon: 'chart' },
  { to: '/activity', label: 'Activity Log', icon: 'activity', owner: true },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => { setNavOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isOwner = user?.role === 'OWNER'
  const name = user?.name || ''
  const userInitials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?'

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <nav className="sidebar" aria-label="Main">
        <Brand />
        {links.filter((l) => !l.owner || isOwner).map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={l.icon} />
            {l.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="user">
          <span className="avatar">{userInitials}</span>
          <div className="who">
            <strong>{name}</strong>
            {user?.role?.toLowerCase()}
          </div>
          <button onClick={logout} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
        </div>
      </nav>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />

      <div className="content">
        <header className="topbar">
          <button className="menu-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Icon name="menu" />
          </button>
          <button className="search-trigger" onClick={() => setSearchOpen(true)}>
            <Icon name="search" />
            <span>Search patients…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <div className="quick">
            <Link className="btn ghost sm" to="/appointments?new=1" title="Book appointment">
              <Icon name="calendar" /><span className="label">Book</span>
            </Link>
            <Link className="btn sm" to="/patients?new=1" title="New patient">
              <Icon name="plus" /><span className="label">New patient</span>
            </Link>
          </div>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>

      {searchOpen && <PatientSearch onClose={() => setSearchOpen(false)} />}
    </div>
  )
}
