import { useEffect, useState } from 'react'
import { get } from '../lib/api'
import { fmtDateTime } from '../lib/format'

const ENTITIES = ['', 'patient', 'ledger_entry', 'treatment_plan', 'plan_freebie', 'visit', 'appointment', 'procedure', 'package_template', 'patient_file', 'user']
const ACTIONS = ['', 'CREATE', 'UPDATE', 'DELETE', 'ARCHIVE', 'VOID', 'REFUND', 'USE', 'RESTORE', 'LOGIN']

// Compact one-line summary of an audit row's detail JSON.
function summarize(d) {
  if (!d || typeof d !== 'object') return ''
  const bits = []
  if (d.name) bits.push(d.name)
  if (d.receiptNo) bits.push(d.receiptNo)
  if (d.reason) bits.push(`“${d.reason}”`)
  if (d.amount != null) bits.push(`₱${Number(d.amount).toLocaleString('en-PH')}`)
  if (d.method) bits.push(String(d.method).toLowerCase())
  if (d.status && typeof d.status === 'object') bits.push(`${d.status.from} → ${d.status.to}`)
  else if (d.status) bits.push(String(d.status))
  if (d.defaultPrice?.from != null) bits.push(`price ₱${d.defaultPrice.from} → ₱${d.defaultPrice.to}`)
  if (d.values) for (const [k, v] of Object.entries(d.values)) bits.push(`${k} ${v.from} → ${v.to}`)
  if (d.qty != null) bits.push(`×${d.qty}`)
  if (Array.isArray(d.procedures)) bits.push(d.procedures.map((p) => `${p.name}${p.qty > 1 ? `×${p.qty}` : ''}`).join(', '))
  if (d.changed?.length && !bits.length) bits.push(`changed: ${d.changed.join(', ')}`)
  return bits.join(' · ')
}

export default function Activity() {
  const [rows, setRows] = useState(null)
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = () => {
    const q = new URLSearchParams()
    if (entity) q.set('entity', entity)
    if (action) q.set('action', action)
    if (from) q.set('from', from)
    if (to) q.set('to', to + 'T23:59:59')
    q.set('limit', '200')
    get(`/audit?${q}`).then(setRows).catch(() => setRows([]))
  }
  useEffect(load, [entity, action, from, to])

  return (
    <>
      <div className="page-head"><h1>Activity log</h1></div>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          <select className="search" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">All records</option>
            {ENTITIES.filter(Boolean).map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
          </select>
          <select className="search" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {ACTIONS.filter(Boolean).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input type="date" className="search" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="search" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {!rows ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No matching activity.</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.createdAt)}</td>
                  <td>{r.user || '—'}</td>
                  <td><span className="badge gray">{r.action}</span></td>
                  <td>{r.entity.replace('_', ' ')}</td>
                  <td style={{ color: 'var(--ink-soft)' }}>{summarize(r.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
