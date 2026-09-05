import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../lib/api'
import { fmtTime, peso, fullName } from '../lib/format'
import StatusBadge from '../components/StatusBadge'

export default function Dashboard() {
  const [today, setToday] = useState([])
  const [income, setIncome] = useState(null)
  const [owing, setOwing] = useState(null)

  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)
    get(`/appointments?from=${start.toISOString()}&to=${end.toISOString()}`).then(setToday).catch(() => {})
    get('/reports/daily-income').then(setIncome).catch(() => {})
    get('/reports/outstanding-balances').then(setOwing).catch(() => {})
  }, [])

  return (
    <>
      <div className="page-head"><h1>Dashboard</h1></div>

      <div className="stat-row">
        <div className="stat">
          <div className="label">Appointments today</div>
          <div className="value">{today.length}</div>
        </div>
        <div className="stat">
          <div className="label">Income today</div>
          <div className="value">{peso(income?.total ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Total outstanding</div>
          <div className="value">{peso(owing?.totalOutstanding ?? 0)}</div>
        </div>
      </div>

      <div className="card">
        <h2>Today's schedule</h2>
        {today.length === 0 ? (
          <div className="empty">No appointments today. Book one from the Appointments page.</div>
        ) : (
          <table className="data">
            <thead><tr><th>Time</th><th>Patient</th><th>Note</th><th>Status</th></tr></thead>
            <tbody>
              {today.map((a) => (
                <tr key={a.id}>
                  <td>{fmtTime(a.startsAt)}</td>
                  <td>{a.patientId
                    ? <Link to={`/patients/${a.patientId}`}>{a.patientName}</Link>
                    : a.patientName}</td>
                  <td>{a.note || '—'}</td>
                  <td><StatusBadge value={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Patients with balances</h2>
        {!owing || owing.rows.length === 0 ? (
          <div className="empty">No outstanding balances. 🎉</div>
        ) : (
          <table className="data">
            <thead><tr><th>Patient</th><th>Phone</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {owing.rows.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/patients/${r.id}`}>{fullName(r)}</Link></td>
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
