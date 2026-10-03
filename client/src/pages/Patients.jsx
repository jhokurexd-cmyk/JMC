import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { get, post } from '../lib/api'
import { peso, fullName, fmtDate, initials, ageOf } from '../lib/format'
import Modal from '../components/Modal'
import Icon from '../components/Icon'
import { Loading, LoadError } from '../components/LoadState'
import { useToast } from '../components/Toast'

const emptyForm = {
  firstName: '', lastName: '', middleName: '', birthDate: '', sex: '',
  phone: '', email: '', address: '', guardianName: '', guardianPhone: '',
  allergies: '', medicalNotes: '', consentSigned: false,
}

export default function Patients() {
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [patients, setPatients] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [dups, setDups] = useState(null)
  const [busy, setBusy] = useState(false)

  const showAdd = searchParams.get('new') === '1'
  const setShowAdd = (open) =>
    setSearchParams((sp) => {
      if (open) sp.set('new', '1')
      else sp.delete('new')
      return sp
    }, { replace: true })

  const load = () => {
    setLoadError(null)
    return get(`/patients${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      .then(setPatients)
      .catch(setLoadError)
  }

  useEffect(() => {
    const t = setTimeout(() => {
      load()
      setSearchParams((sp) => {
        if (search) sp.set('q', search)
        else sp.delete('q')
        return sp
      }, { replace: true })
    }, 250)
    return () => clearTimeout(t)
  }, [search])

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const closeAdd = () => {
    setShowAdd(false)
    setDups(null)
    setError('')
  }

  const save = async (force = false) => {
    if (!form.consentSigned) {
      setError('Patient consent must be recorded before saving (Data Privacy Act).')
      return
    }
    setBusy(true)
    setError('')
    const body = { ...form, ...(force ? { force: true } : {}) }
    if (!body.birthDate) delete body.birthDate
    if (!body.email) delete body.email
    try {
      const created = await post('/patients', body)
      setForm(emptyForm)
      setDups(null)
      toast(`${fullName(created)} registered`)
      navigate(`/patients/${created.id}`)
    } catch (e) {
      if (e.status === 409 && Array.isArray(e.data?.possibleDuplicates)) {
        setDups({ message: e.message, rows: e.data.possibleDuplicates })
      } else {
        setError(e.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const openRow = (p) => navigate(`/patients/${p.id}`)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Patients</h1>
          {patients && (
            <div className="sub">
              {patients.length >= 100
                ? 'Showing the first 100 — search to narrow down'
                : `${patients.length} ${search ? 'matching' : 'active'} patient${patients.length === 1 ? '' : 's'}`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, flex: '1 1 320px', justifyContent: 'flex-end' }}>
          <input className="search" type="search" placeholder="Search name or phone…" aria-label="Search patients"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn" onClick={() => setShowAdd(true)}><Icon name="plus" />Add patient</button>
        </div>
      </div>

      <div className="card">
        {loadError ? (
          <LoadError error={loadError} onRetry={load} />
        ) : !patients ? (
          <Loading />
        ) : patients.length === 0 ? (
          <div className="empty">
            {search ? 'No patients match that search.' : 'No patients yet. Add the first one.'}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Age</th><th>Registered</th><th className="num">Total Due</th><th></th></tr>
            </thead>
            <tbody>
              {patients.map((p) => {
                const age = ageOf(p.birthDate)
                return (
                  <tr key={p.id} className="rowlink" tabIndex={0} onClick={() => openRow(p)}
                    onKeyDown={(e) => e.key === 'Enter' && openRow(p)}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                        <span className="avatar" style={{ width: 28, height: 28, fontSize: '.72rem' }}>{initials(p)}</span>
                        <span>
                          {fullName(p)}{' '}
                          {p.allergies && <span className="badge red">Allergy</span>}
                        </span>
                      </span>
                    </td>
                    <td>{p.phone || '—'}</td>
                    <td>{age ?? '—'}</td>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td className="num">
                      {p.balance > 0
                        ? <span style={{ color: 'var(--money)', fontWeight: 600 }}>{peso(p.balance)}</span>
                        : peso(p.balance)}
                    </td>
                    <td style={{ color: 'var(--ink-soft)' }}>›</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <Modal title="New patient" onClose={closeAdd} busy={busy}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="np-first">First name *</label>
              <input id="np-first" autoFocus value={form.firstName} onChange={set('firstName')} />
            </div>
            <div className="field">
              <label htmlFor="np-last">Last name *</label>
              <input id="np-last" value={form.lastName} onChange={set('lastName')} />
            </div>
            <div className="field">
              <label htmlFor="np-birth">Birth date</label>
              <input id="np-birth" type="date" max={new Date().toISOString().slice(0, 10)}
                value={form.birthDate} onChange={set('birthDate')} />
            </div>
            <div className="field">
              <label htmlFor="np-sex">Sex</label>
              <select id="np-sex" value={form.sex} onChange={set('sex')}>
                <option value="">—</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="np-phone">Phone</label>
              <input id="np-phone" type="tel" value={form.phone} onChange={set('phone')} />
            </div>
            <div className="field">
              <label htmlFor="np-email">Email</label>
              <input id="np-email" type="email" value={form.email} onChange={set('email')} />
            </div>
            <div className="field full">
              <label htmlFor="np-address">Address</label>
              <input id="np-address" value={form.address} onChange={set('address')} />
            </div>
            <div className="field">
              <label htmlFor="np-gname">Guardian name (if minor)</label>
              <input id="np-gname" value={form.guardianName} onChange={set('guardianName')} />
            </div>
            <div className="field">
              <label htmlFor="np-gphone">Guardian phone</label>
              <input id="np-gphone" type="tel" value={form.guardianPhone} onChange={set('guardianPhone')} />
            </div>
            <div className="field full">
              <label htmlFor="np-allergies">Allergies (shown as a red alert everywhere)</label>
              <input id="np-allergies" value={form.allergies} onChange={set('allergies')}
                placeholder="e.g. Penicillin, Lidocaine" />
            </div>
            <div className="field full">
              <label htmlFor="np-notes">Medical notes</label>
              <textarea id="np-notes" rows={2} value={form.medicalNotes} onChange={set('medicalNotes')} />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.consentSigned} onChange={set('consentSigned')} />
            <span>
              The patient has been informed of and consented to the collection and use of their
              personal and health information for clinic care and records (RA 10173).
            </span>
          </label>

          {dups && (
            <div className="dup-box">
              <strong>{dups.message}</strong>
              <ul>
                {dups.rows.map((d) => (
                  <li key={d.id ?? d.name + d.createdAt}>
                    {d.id ? <Link to={`/patients/${d.id}`} onClick={closeAdd}>{d.name}</Link> : d.name}
                    {d.phone ? ` (${d.phone})` : ''} — added {fmtDate(d.createdAt)}
                  </li>
                ))}
              </ul>
              <button className="btn ghost sm" disabled={busy} onClick={() => save(true)}>
                It's a different person — add anyway
              </button>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={closeAdd}>Cancel</button>
            <button className="btn" disabled={busy || !form.firstName || !form.lastName} onClick={() => save(false)}>
              {busy ? 'Saving…' : 'Save patient'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
