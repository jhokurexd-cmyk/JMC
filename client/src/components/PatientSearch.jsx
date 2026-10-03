import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get } from '../lib/api'
import { fullName, initials, peso } from '../lib/format'
import Icon from './Icon'

export default function PatientSearch({ onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      get(`/patients${q ? `?search=${encodeURIComponent(q)}` : ''}`)
        .then((r) => { if (live) { setRows(r.slice(0, 8)); setActive(0) } })
        .catch(() => { if (live) setRows([]) })
        .finally(() => { if (live) setLoading(false) })
    }, 150)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  const open = (p) => { onClose(); navigate(`/patients/${p.id}`) }

  const onKey = (e) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && rows[active]) open(rows[active])
  }

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal cmdk" role="dialog" aria-label="Find a patient">
        <div className="cmdk-input">
          <Icon name="search" />
          <input autoFocus placeholder="Find a patient by name or phone…" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} aria-label="Search patients" />
        </div>
        {!loading && rows.length === 0 ? (
          <div className="empty">{q ? 'No patients match.' : 'No patients yet.'}</div>
        ) : (
          <ul role="listbox">
            {rows.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === active} className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)} onClick={() => open(p)}>
                <span className="avatar">{initials(p)}</span>
                <span>
                  {fullName(p)} {p.allergies && <span className="badge red">Allergy</span>}
                  <div className="sub">{p.phone || 'no phone'}</div>
                </span>
                {p.balance > 0 && <span className="due">{peso(p.balance)}</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="cmdk-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
