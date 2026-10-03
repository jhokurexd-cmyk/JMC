import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { get, downloadFile } from '../lib/api'
import { peso, fmtTime, fullName } from '../lib/format'
import { useAuth } from '../context/AuthContext'

const iso = (d) => d.toISOString().slice(0, 10)
const daysAgo = (n) => iso(new Date(Date.now() - n * 86400000))

function DownloadCsv({ path, filename }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className="btn ghost" disabled={busy}
      onClick={async () => { setBusy(true); try { await downloadFile(path, filename) } finally { setBusy(false) } }}>
      {busy ? 'Preparing…' : 'Download CSV'}
    </button>
  )
}

function RangeReport({ title, report }) {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(iso(new Date()))
  const q = `from=${from}&to=${to}`
  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>{title}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" className="search" style={{ minWidth: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <span style={{ color: 'var(--ink-soft)' }}>to</span>
          <input type="date" className="search" style={{ minWidth: 150 }} value={to} onChange={(e) => setTo(e.target.value)} />
          <DownloadCsv path={`/reports/${report}.csv?${q}`} filename={`${report}_${from}_to_${to}.csv`} />
        </div>
      </div>
      <p style={{ color: 'var(--ink-soft)', fontSize: '.88rem', margin: 0 }}>
        {report === 'transactions'
          ? 'Every ledger charge, payment and discount in the range — for your accountant / bookkeeping.'
          : 'Every visit and the procedures done, one row per procedure.'}
        {' '}Range max 366 days.
      </p>
    </div>
  )
}

function SpreadsheetPanel() {
  const [info, setInfo] = useState(null)
  const [copied, setCopied] = useState('')
  useEffect(() => { get('/reports/feed-info').then(setInfo).catch(() => setInfo({ configured: false })) }, [])
  if (!info) return null

  const copy = (text, key) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(''), 1500) }).catch(() => {})
  }
  const url = (r) => `${info.baseUrl}/api/v1/feed/${r}.csv?token=${info.token}`

  return (
    <div className="card">
      <h2>Connect a spreadsheet</h2>
      {!info.configured ? (
        <p style={{ color: 'var(--ink-soft)' }}>
          Set <code>REPORT_TOKEN</code> in <code>server/.env</code> and restart the API to enable a
          live feed that Google Sheets and Excel can pull from.
        </p>
      ) : (
        <>
          <p style={{ color: 'var(--ink-soft)', fontSize: '.9rem', marginTop: 0 }}>
            These URLs are read-only report feeds. Anyone with a link can see the data — rotate
            <code> REPORT_TOKEN</code> (and restart) to revoke.
          </p>
          {[
            ['outstanding-balances', 'Total Due by patient'],
            ['income', 'Income (this month + totals)'],
          ].map(([r, label]) => (
            <div key={r} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{label}</div>
              <div style={{ fontSize: '.82rem', color: 'var(--ink-soft)', margin: '2px 0' }}>
                Google Sheets — paste into a cell:
              </div>
              <code style={{ display: 'block', background: 'var(--bg)', padding: '6px 8px', borderRadius: 6, wordBreak: 'break-all', fontSize: '.8rem' }}>
                =IMPORTDATA("{url(r)}")
              </code>
              <button className="btn quiet" style={{ marginTop: 4, padding: '3px 10px', fontSize: '.8rem' }}
                onClick={() => copy(`=IMPORTDATA("${url(r)}")`, r)}>
                {copied === r ? 'Copied ✓' : 'Copy formula'}
              </button>{' '}
              <button className="btn quiet" style={{ marginTop: 4, padding: '3px 10px', fontSize: '.8rem' }}
                onClick={() => copy(url(r), `${r}-url`)}>
                {copied === `${r}-url` ? 'Copied ✓' : 'Copy URL (Excel: Data → From Web)'}
              </button>
            </div>
          ))}
          <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
            Transactions / Visits feeds also work — append <code>&amp;from=YYYY-MM-DD&amp;to=YYYY-MM-DD</code>
            to <code>{info.baseUrl}/api/v1/feed/transactions.csv?token=…</code>.
          </p>
        </>
      )}
    </div>
  )
}

export default function Reports() {
  const { user } = useAuth()
  const [date, setDate] = useState(iso(new Date()))
  const [income, setIncome] = useState(null)
  const [owing, setOwing] = useState(null)

  useEffect(() => { get(`/reports/daily-income?date=${date}`).then(setIncome).catch(() => {}) }, [date])
  useEffect(() => { get('/reports/outstanding-balances').then(setOwing).catch(() => {}) }, [])

  return (
    <>
      <div className="page-head">
        <h1>Reports</h1>
        <input type="date" className="search" style={{ minWidth: 160 }}
          value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 6 }}>
          <h2>Income for {date}</h2>
          <DownloadCsv path={`/reports/income.csv?date=${date}`} filename={`income_${date.slice(0, 7)}.csv`} />
        </div>
        <div className="balance-line clear" style={{ margin: '6px 0 4px' }}>{peso(income?.net ?? 0)}</div>
        <p style={{ color: 'var(--ink-soft)', margin: '0 0 10px', fontSize: '.88rem' }}>
          Gross {peso(income?.gross ?? 0)}
          {income?.refundsVoids ? ` · refunds & voids −${peso(income.refundsVoids)}` : ''}
          {' · net collected'}
        </p>
        {income && Object.keys(income.byMethod).length > 0 && (
          <p style={{ color: 'var(--ink-soft)', marginTop: 0 }}>
            {Object.entries(income.byMethod).map(([m, v]) => `${m.replace('_', ' ').toLowerCase()}: ${peso(v)}`).join(' · ')}
          </p>
        )}
        {income && income.payments.filter((p) => !p.reversalOfId).length > 0 && (
          <table className="data">
            <thead><tr><th>Time</th><th>Patient</th><th>Note</th><th>Status</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {income.payments.filter((p) => !p.reversalOfId).map((p) => {
                const dead = (p.reversedBy?.length ?? 0) > 0
                return (
                  <tr key={p.id} className={dead ? 'row-voided' : undefined}>
                    <td>{fmtTime(p.createdAt)}</td>
                    <td>{fullName(p.patient)}</td>
                    <td>{p.note || '—'}</td>
                    <td>{dead ? (p.reversedBy[0].reversalKind === 'REFUND' ? 'Refunded' : 'Voided') : 'Collected'}</td>
                    <td className="num">{peso(p.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {income && income.payments.filter((p) => !p.reversalOfId).length === 0 && <div className="empty">No payments recorded this day.</div>}
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 6 }}>
          <h2>Total Due by patient</h2>
          <DownloadCsv path="/reports/outstanding-balances.csv" filename="total-due-by-patient.csv" />
        </div>
        {owing && (
          <div className="balance-line owed" style={{ margin: '6px 0 10px' }}>{peso(owing.totalOutstanding)}</div>
        )}
        {!owing || owing.rows.length === 0 ? (
          <div className="empty">Nobody has a Total Due right now.</div>
        ) : (
          <table className="data">
            <thead><tr><th>Patient</th><th>Phone</th><th className="num">Total Due</th></tr></thead>
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

      <RangeReport title="Transactions (ledger export)" report="transactions" />
      <RangeReport title="Visits & procedures log" report="visits" />

      {user?.role === 'OWNER' && <SpreadsheetPanel />}
    </>
  )
}
