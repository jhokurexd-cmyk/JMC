import { useEffect, useState } from 'react'
import { get } from '../lib/api'
import { fullName } from '../lib/format'

// Server-side search so the choice isn't limited to the first page of /patients.
export default function PatientPicker({ id, value, label, onChange }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    const t = setTimeout(() => {
      get(`/patients${q ? `?search=${encodeURIComponent(q)}` : ''}`)
        .then((r) => live && setRows(r.slice(0, 10)))
        .catch(() => live && setRows([]))
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [q, open])

  if (value) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input id={id} value={label} readOnly style={{ flex: 1, background: 'var(--bg)' }} />
        <button type="button" className="btn quiet sm" onClick={() => { onChange(null); setQ(''); setOpen(true) }}>
          Change
        </button>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <input id={id} value={q} placeholder="Search registered patients… (leave blank for a walk-in)"
        autoComplete="off" style={{ width: '100%' }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }} />
      {open && rows.length > 0 && (
        <ul style={{
          position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', marginTop: 4, listStyle: 'none',
          padding: 4, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 6,
          boxShadow: 'var(--shadow)', maxHeight: 240, overflowY: 'auto',
        }}>
          {rows.map((p) => (
            <li key={p.id}>
              <button type="button" className="btn quiet" style={{ width: '100%', justifyContent: 'space-between', border: 'none' }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(p); setOpen(false) }}>
                <span style={{ color: 'var(--ink)' }}>{fullName(p)}</span>
                <span style={{ fontSize: '.8rem', fontWeight: 400 }}>{p.phone || ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
