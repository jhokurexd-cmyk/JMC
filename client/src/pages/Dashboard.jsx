import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { get } from '../lib/api'
import { fmtDate, fmtDateTime, fmtTime, peso } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import StatusBadge from '../components/StatusBadge'
import Icon from '../components/Icon'
import { Loading, LoadError } from '../components/LoadState'
import WeekBars from '../components/WeekBars'

const OPEN_STATUSES = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_CHAIR']

const visitLink = (a) =>
  `/patients/${a.patientId}?tab=visits&fromAppt=${a.id}${a.dentist ? `&dentist=${encodeURIComponent(a.dentist)}` : ''}`

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { user } = useAuth()
  const [d, setD] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setError(null)
    get('/reports/dashboard').then(setD).catch(setError)
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <LoadError error={error} onRetry={load} />
  if (!d) return <Loading />

  const tile = (to, icon, label, value, hint) => (
    <Link to={to} className="stat with-icon">
      <span className="stat-icon"><Icon name={icon} /></span>
      <div>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        {hint && <div className="hint">{hint}</div>}
      </div>
    </Link>
  )
  const displayName = user?.name || ''

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">
            {greeting()}{displayName ? `, ${displayName}` : ''}! Here's what's happening today.
          </div>
        </div>
        <div className="quick-actions">
          <Link className="btn ghost" to="/appointments?new=1"><Icon name="calendar" />Book appointment</Link>
          <Link className="btn" to="/patients?new=1"><Icon name="plus" />New patient</Link>
        </div>
      </div>

      <div className="stat-row">
        {tile('/appointments', 'calendar', "Today's Appointments", d.todayAppointments.length,
          `${d.todayPatientCount} patient${d.todayPatientCount === 1 ? '' : 's'} today`)}
        {tile('/patients', 'users', 'Total Patients', d.totalPatients ?? '—', 'active records')}
        {tile('/income', 'wallet', 'Income Today', peso(d.income.net),
          d.income.refundsVoids ? `−${peso(d.income.refundsVoids)} refunds/voids` : `gross ${peso(d.income.gross)}`)}
        {tile('/reports', 'receipt', 'Total Due', peso(d.outstanding.total), 'all patients')}
      </div>

      <div className="grid-main">
        <div className="card">
          <div className="card-head">
            <h2>Today's Appointments</h2>
            <span className="meta">{format(new Date(), 'MMMM d, yyyy')}</span>
            <Link className="btn quiet sm" to="/appointments">View All</Link>
          </div>
          {d.todayAppointments.length === 0 ? (
            <div className="empty">No appointments today.</div>
          ) : (
            <ul className="appt-list">
              {d.todayAppointments.map((a) => (
                <li key={a.id}>
                  <span className="time">{fmtTime(a.startsAt)}</span>
                  <span className="avatar" style={{ width: 30, height: 30 }}><Icon name="user" /></span>
                  <span className="who">
                    {a.patientId ? <Link to={`/patients/${a.patientId}`}>{a.patientName}</Link> : a.patientName}
                  </span>
                  <span className="what">{a.note || a.dentist || '—'}</span>
                  <span className="end">
                    <StatusBadge value={a.status} />
                    {a.patientId && OPEN_STATUSES.includes(a.status) && (
                      <Link className="btn ghost sm" to={visitLink(a)} title="Record visit">Record visit</Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="card">
            <div className="card-head">
              <h2>Appointment Overview</h2>
              <span className="meta">This week</span>
            </div>
            <WeekBars />
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Upcoming</h2>
              <Link className="btn quiet sm" to="/appointments">View All</Link>
            </div>
            {d.upcoming.length === 0 ? (
              <div className="empty">Nothing scheduled ahead.</div>
            ) : (
              <ul className="person-list">
                {d.upcoming.map((a) => (
                  <li key={a.id}>
                    <span className="avatar" style={{ width: 30, height: 30 }}><Icon name="user" /></span>
                    <span className="grow">
                      {a.patientId ? <Link to={`/patients/${a.patientId}`}>{a.patientName}</Link> : a.patientName}
                      {a.dentist && <div className="side">{a.dentist}</div>}
                    </span>
                    <span className="side">{fmtDateTime(a.startsAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Braces adjustments due</h2>
          {d.bracesDue.length === 0 ? (
            <div className="empty">None due in the next 7 days.</div>
          ) : (
            <table className="data">
              <thead><tr><th>Patient</th><th>Package</th><th>Next</th><th className="num">Monthly</th></tr></thead>
              <tbody>
                {d.bracesDue.map((r) => (
                  <tr key={r.patientId + r.planName}>
                    <td><Link to={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                    <td>{r.planName}</td>
                    <td style={{ color: new Date(r.nextDate) < new Date() ? 'var(--danger)' : 'inherit' }}>{fmtDate(r.nextDate)}</td>
                    <td className="num">{r.monthlyDue ? peso(r.monthlyDue) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Overdue balances</h2>
          {d.overdue.length === 0 ? (
            <div className="empty">No balances older than 30 days.</div>
          ) : (
            <table className="data">
              <thead><tr><th>Patient</th><th>Since</th><th className="num">Total Due</th></tr></thead>
              <tbody>
                {d.overdue.map((r) => (
                  <tr key={r.patientId}>
                    <td><Link to={`/patients/${r.patientId}?tab=payments`}>{r.patientName}</Link></td>
                    <td style={{ color: 'var(--danger)' }}>{fmtDate(r.since)}</td>
                    <td className="num">{peso(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Patients with a balance</h2>
          {d.outstanding.rows.length > 8 && <Link to="/reports">All {d.outstanding.rows.length} →</Link>}
        </div>
        {d.outstanding.rows.length === 0 ? (
          <div className="empty">Nobody has a Total Due right now.</div>
        ) : (
          <table className="data">
            <thead><tr><th>Patient</th><th>Phone</th><th className="num">Total Due</th></tr></thead>
            <tbody>
              {d.outstanding.rows.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/patients/${r.id}?tab=payments`}>{r.name}</Link></td>
                  <td>{r.phone || '—'}</td>
                  <td className="num">{peso(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
