import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { get, post } from '../lib/api'
import { peso, fullName, fmtDate } from '../lib/format'
import Modal from '../components/Modal'

const emptyForm = {
  firstName: '', lastName: '', middleName: '', birthDate: '', sex: '',
  phone: '', email: '', address: '', guardianName: '', guardianPhone: '',
  allergies: '', medicalNotes: '', consentSigned: false,
}

export default function Patients() {
  const navigate = useNavigate()
  const [patients, setPatients] = useState([])
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () =>
    get(`/patients${search ? `?search=${encodeURIComponent(search)}` : ''}`)
      .then(setPatients)
      .catch(() => {})

  useEffect(() => {
    const t = setTimeout(load, 250) // debounce typing
    return () => clearTimeout(t)
  }, [search])

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const save = async () => {
    if (!form.consentSigned) {
      setError('Patient consent must be recorded before saving (Data Privacy Act).')
      return
    }
    setBusy(true)
    setError('')
    try {
      const body = { ...form }
      if (!body.birthDate) delete body.birthDate
      if (!body.email) delete body.email
      const created = await post('/patients', body)
      setShowAdd(false)
      setForm(emptyForm)
      navigate(`/patients/${created.id}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Patients</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <input className="search" placeholder="Search name or phone…"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className="btn" onClick={() => setShowAdd(true)}>Add patient</button>
        </div>
      </div>

      <div className="card">
        {patients.length === 0 ? (
          <div className="empty">
            {search ? 'No patients match that search.' : 'No patients yet. Add the first one.'}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Last added</th><th className="num">Balance</th><th></th></tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="rowlink" onClick={() => navigate(`/patients/${p.id}`)}>
                  <td>
                    {fullName(p)}{' '}
                    {p.allergies && <span className="badge red">Allergy</span>}
                  </td>
                  <td>{p.phone || '—'}</td>
                  <td>{fmtDate(p.createdAt)}</td>
                  <td className="num">
                    {p.balance > 0
                      ? <span style={{ color: 'var(--money)', fontWeight: 600 }}>{peso(p.balance)}</span>
                      : peso(p.balance)}
                  </td>
                  <td style={{ color: 'var(--ink-soft)' }}>›</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <Modal title="New patient" onClose={() => setShowAdd(false)}>
          <div className="form-grid">
            <div className="field">
              <label>First name *</label>
              <input value={form.firstName} onChange={set('firstName')} />
            </div>
            <div className="field">
              <label>Last name *</label>
              <input value={form.lastName} onChange={set('lastName')} />
            </div>
            <div className="field">
              <label>Birth date</label>
              <input type="date" value={form.birthDate} onChange={set('birthDate')} />
            </div>
            <div className="field">
              <label>Sex</label>
              <select value={form.sex} onChange={set('sex')}>
                <option value="">—</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
              </select>
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone} onChange={set('phone')} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email} onChange={set('email')} />
            </div>
            <div className="field full">
              <label>Address</label>
              <input value={form.address} onChange={set('address')} />
            </div>
            <div className="field">
              <label>Guardian name (if minor)</label>
              <input value={form.guardianName} onChange={set('guardianName')} />
            </div>
            <div className="field">
              <label>Guardian phone</label>
              <input value={form.guardianPhone} onChange={set('guardianPhone')} />
            </div>
            <div className="field full">
              <label>Allergies (shown as a red alert everywhere)</label>
              <input value={form.allergies} onChange={set('allergies')}
                placeholder="e.g. Penicillin, Lidocaine" />
            </div>
            <div className="field full">
              <label>Medical notes</label>
              <textarea rows={2} value={form.medicalNotes} onChange={set('medicalNotes')} />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={form.consentSigned} onChange={set('consentSigned')} />
            <span>
              The patient has been informed of and consented to the collection and use of their
              personal and health information for clinic care and records (RA 10173).
            </span>
          </label>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShowAdd(false)}>Cancel</button>
            <button className="btn" disabled={busy || !form.firstName || !form.lastName} onClick={save}>
              {busy ? 'Saving…' : 'Save patient'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
