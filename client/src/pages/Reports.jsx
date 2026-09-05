import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get } from '../lib/api'
import { peso, fmtTime, fullName } from '../lib/format'

export default function Reports() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [income, setIncome] = useState(null)
  const [owing, setOwing] = useState(null)

  useEffect(() => {
    get(`/reports/daily-income?date=${date}`).then(setIncome).catch(() => {})
  }, [date])
  useEffect(() => {
    get('/reports/outstanding-balances').then(setOwing).catch(() => {})
  }, [])

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <input type="date" className="search" style={{ minWidth: 160 }}
          value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="card">
        <h2>Income for {date}</h2>
        <div className="balance-line clear" style={{ margin: '6px 0 10px' }}>
          {peso(income?.total ?? 0)}
        </div>
        {income && Object.keys(income.byMethod).length > 0 && (
          <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
            {Object.entries(income.byMethod)
              .map(([m, v]) => `${m.replace('_', ' ').toLowerCase()}: ${peso(v)}`)
              .join(' · ')}
          </p>
        )}
        {income && income.payments.length > 0 && (
          <table className="data">
            <thead><tr><th>Time</th><th>Patient</th><th>Note</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {income.payments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtTime(p.createdAt)}</td>
                  <td>{fullName(p.patient)}</td>
                  <td>{p.note || '—'}</td>
                  <td className="num">{peso(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {income && income.payments.length === 0 && <div className="empty">No payments recorded this day.</div>}
      </div>

      <div className="card">
        <h2>Outstanding balances</h2>
        {owing && (
          <div className="balance-line owed" style={{ margin: '6px 0 10px' }}>
            {peso(owing.totalOutstanding)}
          </div>
        )}
        {!owing || owing.rows.length === 0 ? (
          <div className="empty">Nobody owes anything right now.</div>
        ) : (
          <table className="data">
            <thead><tr><th>Patient</th><th>Phone</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {owing.rows.map((r) => (
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
