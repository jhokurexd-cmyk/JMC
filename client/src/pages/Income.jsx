import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, downloadFile } from '../lib/api'
import { peso, fmtDate, fmtTime, fullName } from '../lib/format'

const PERIODS = [
  ['day', 'Daily'],
  ['week', 'Weekly'],
  ['month', 'Monthly'],
]

export default function Income() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState('day')
  const [dl, setDl] = useState(false)

  useEffect(() => {
    get(`/reports/income?date=${date}`).then(setData).catch(() => {})
  }, [date])

  const download = async () => {
    setDl(true)
    try {
      await downloadFile(`/reports/income.csv?date=${date}`, `income_${date.slice(0, 7)}.csv`)
    } finally {
      setDl(false)
    }
  }

  const active = data?.[period]

  // Server gives gross / refundsVoids / net (retroactive — a payment voided later
  // drops out of its original period). `payments` still holds every row for the
  // detail list; reversal rows (reversalOfId set) are not shown on their own.
  const rows = (active?.payments ?? []).filter((p) => !p.reversalOfId)
  const isDead = (p) => (p.reversedBy?.length ?? 0) > 0
  const live = rows.filter((p) => !isDead(p))
  const count = live.length
  const patientCount = new Set(live.filter((p) => p.patientId).map((p) => p.patientId)).size
  const avg = count ? (active?.net ?? 0) / count : 0
  const methodRows = Object.entries(active?.byMethod ?? {}).sort((a, b) => b[1] - a[1])

  const summaryItem = (label, value) => (
    <div>
      <div style={{ fontSize: '.8rem', color: 'var(--ink-soft)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )

  return (
    <>
      <div className="page-head">
        <h1>Income</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <input type="date" className="search" style={{ minWidth: 160 }}
            value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn ghost" disabled={dl} onClick={download}>
            {dl ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>

      <div className="stat-row">
        {PERIODS.map(([key, label]) => (
          <button
            key={key}
            className="stat"
            onClick={() => setPeriod(key)}
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              borderColor: period === key ? 'var(--primary)' : 'var(--line)',
              outline: period === key ? '2px solid var(--primary-tint)' : 'none',
            }}
          >
            <div className="label">{label} net income</div>
            <div className="value">{peso(data?.[key]?.net ?? 0)}</div>
            <div style={{ fontSize: '.8rem', color: 'var(--ink-soft)', marginTop: 2 }}>
              {data?.[key]
                ? `${fmtDate(data[key].from)} – ${fmtDate(data[key].to)}${data[key].refundsVoids ? ` · −${peso(data[key].refundsVoids)} refunds/voids` : ''}`
                : '—'}
            </div>
          </button>
        ))}
      </div>

      <div className="card">
        <h2>{PERIODS.find(([k]) => k === period)[1]} breakdown</h2>
        {active && (
          <div style={{ fontSize: '.85rem', color: 'var(--ink-soft)', marginTop: 2 }}>
            {fmtDate(active.from)} – {fmtDate(active.to)}
          </div>
        )}

        {!active || rows.length === 0 ? (
          <div className="empty">No payments recorded in this period.</div>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16,
              padding: '14px 0', borderBottom: '1px solid var(--line)', marginBottom: 14,
            }}>
              {summaryItem('Gross collected', peso(active.gross ?? 0))}
              {summaryItem('Refunds & voids', active.refundsVoids ? `−${peso(active.refundsVoids)}` : peso(0))}
              {summaryItem('Net collected', peso(active.net ?? 0))}
              {summaryItem('Payments', count)}
              {summaryItem('Patients', patientCount)}
              {summaryItem('Avg / payment', peso(avg))}
            </div>

            <table className="data" style={{ marginBottom: 18 }}>
              <thead>
                <tr><th>Method (net)</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {methodRows.map(([m, v]) => (
                  <tr key={m}>
                    <td>{m.replace('_', ' ').toLowerCase()}</td>
                    <td className="num">{peso(v)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ fontWeight: 700 }}>Net total</td>
                  <td className="num" style={{ fontWeight: 700 }}>{peso(active.net ?? 0)}</td>
                </tr>
              </tbody>
            </table>

            <table className="data">
            <thead>
              <tr><th>Date</th><th>Time</th><th>Patient</th><th>Note</th><th>Status</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={isDead(p) ? 'row-voided' : undefined}>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td>{fmtTime(p.createdAt)}</td>
                  <td>
                    {p.patientId
                      ? <Link to={`/patients/${p.patientId}`}>{fullName(p.patient)}</Link>
                      : fullName(p.patient)}
                  </td>
                  <td>{p.note || '—'}</td>
                  <td>{isDead(p) ? (p.reversedBy[0].reversalKind === 'REFUND' ? 'Refunded' : 'Voided') : 'Collected'}</td>
                  <td className="num">{peso(p.amount)}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </>
        )}
      </div>
    </>
  )
}
