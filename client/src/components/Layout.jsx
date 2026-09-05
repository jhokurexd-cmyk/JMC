import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/patients', label: 'Patients' },
  { to: '/appointments', label: 'Appointments' },
  { to: '/procedures', label: 'Procedures' },
  { to: '/reports', label: 'Reports' },
]

export default function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">Clinic Manager</div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="user">
          {user?.name} · {user?.role?.toLowerCase()}
          <br />
          <button onClick={logout}>Sign out</button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
