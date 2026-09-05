import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { get, post } from '../lib/api'
import { peso, fmtDate, fmtDateTime, fullName } from '../lib/format'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'

export default function PatientDetail() {
  const { id } = useParams()
  const [patient, setPatient] = useState(null)
  const [tab, setTab] = useState('visits')

  const load = useCallback(() => get(`/patients/${id}`).then(setPatient).catch(() => {}), [id])
  useEffect(() => { load() }, [load])

  if (!patient) return <div className="empty">Loading…</div>

  const balanceClass = patient.balance > 0 ? 'owed' : patient.balance < 0 ? 'credit' : 'clear'
  const balanceLabel =
    patient.balance > 0 ? 'Balance due' : patient.balance < 0 ? 'Credit' : 'Fully paid'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{fullName(patient)}</h1>
          <span style={{ color: 'var(--ink-soft)', fontSize: '.9rem' }}>
            {patient.phone || 'no phone'} · {patient.birthDate ? fmtDate(patient.birthDate) : 'no birth date'}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '.85rem', color: 'var(--ink-soft)', fontWeight: 600 }}>{balanceLabel}</div>
          <div className={`balance-line ${balanceClass}`}>{peso(Math.abs(patient.balance))}</div>
        </div>
      </div>

      {patient.allergies && (
        <div className="alert-medical">⚠ Allergies: {patient.allergies}</div>
      )}

      <div className="tabs">
        {['visits', 'ledger', 'plans', 'info'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {{ visits: 'Visits', ledger: 'Ledger & payments', plans: 'Treatment plans', info: 'Info' }[t]}
          </button>
        ))}
      </div>

      {tab === 'visits' && <VisitsTab patientId={id} onChanged={load} />}
      {tab === 'ledger' && <LedgerTab patientId={id} onChanged={load} />}
      {tab === 'plans' && <PlansTab patientId={id} onChanged={load} />}
      {tab === 'info' && <InfoTab patient={patient} />}
    </>
  )
}

/* ----------------------------- Visits ----------------------------- */
function VisitsTab({ patientId, onChanged }) {
  const [visits, setVisits] = useState([])
  const [catalog, setCatalog] = useState([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ visitDate: new Date().toISOString().slice(0, 10), notes: '', nextVisitDate: '' })
  const [lines, setLines] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => get(`/patients/${patientId}/visits`).then(setVisits).catch(() => {})
  useEffect(() => { load(); get('/procedures').then(setCatalog).catch(() => {}) }, [patientId])

  const addLine = () => setLines((l) => [...l, { procedureId: '', toothNumber: '', priceCharged: '' }])
  const setLine = (i, k, v) =>
    setLines((l) => l.map((line, idx) => {
      if (idx !== i) return line
      const next = { ...line, [k]: v }
      if (k === 'procedureId') {
        const proc = catalog.find((c) => c.id === v)
        if (proc && !line.priceCharged) next.priceCharged = proc.defaultPrice
      }
      return next
    }))
  const removeLine = (i) => setLines((l) => l.filter((_, idx) => idx !== i))

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        visitDate: form.visitDate,
        notes: form.notes || null,
        nextVisitDate: form.nextVisitDate || null,
        procedures: lines
          .filter((l) => l.procedureId)
          .map((l) => ({
            procedureId: l.procedureId,
            toothNumber: l.toothNumber || null,
            priceCharged: Number(l.priceCharged) || 0,
          })),
        chargeToLedger: true,
      }
      await post(`/patients/${patientId}/visits`, body)
      setShow(false)
      setLines([])
      setForm({ visitDate: new Date().toISOString().slice(0, 10), notes: '', nextVisitDate: '' })
      load()
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>Visit history</h2>
        <button className="btn" onClick={() => { setShow(true); if (lines.length === 0) addLine() }}>
          Record visit
        </button>
      </div>
      {visits.length === 0 ? (
        <div className="empty">No visits recorded yet.</div>
      ) : (
        visits.map((v) => (
          <div key={v.id} style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
            <strong>{fmtDate(v.visitDate)}</strong>
            {v.dentist && <span style={{ color: 'var(--ink-soft)' }}> · {v.dentist.name}</span>}
            {v.nextVisitDate && (
              <span className="badge teal" style={{ marginLeft: 8 }}>
                Next visit {fmtDate(v.nextVisitDate)}
              </span>
            )}
            {v.procedures.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {v.procedures.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.92rem' }}>
                    <span>
                      {p.procedure.name}
                      {p.toothNumber && <span style={{ color: 'var(--ink-soft)' }}> · tooth {p.toothNumber}</span>}
                    </span>
                    <span className="num">{peso(p.priceCharged)}</span>
                  </div>
                ))}
              </div>
            )}
            {v.notes && <div style={{ color: 'var(--ink-soft)', fontSize: '.9rem', marginTop: 4 }}>{v.notes}</div>}
          </div>
        ))
      )}

      {show && (
        <Modal title="Record visit" onClose={() => setShow(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Visit date</label>
              <input type="date" value={form.visitDate}
                onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))} />
            </div>
            <div className="field">
              <label>Next visit (optional)</label>
              <input type="date" value={form.nextVisitDate}
                onChange={(e) => setForm((f) => ({ ...f, nextVisitDate: e.target.value }))} />
            </div>
          </div>
          <div className="field">
            <label>Procedures done</label>
            {lines.map((line, i) => (
              <div key={i} className="proc-row">
                <select value={line.procedureId} onChange={(e) => setLine(i, 'procedureId', e.target.value)}
                  style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }}>
                  <option value="">Select procedure…</option>
                  {catalog.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input placeholder="Tooth #" value={line.toothNumber}
                  onChange={(e) => setLine(i, 'toothNumber', e.target.value)}
                  style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }} />
                <input type="number" placeholder="Price" value={line.priceCharged}
                  onChange={(e) => setLine(i, 'priceCharged', e.target.value)}
                  style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }} />
                <button className="btn quiet" onClick={() => removeLine(i)} title="Remove">✕</button>
              </div>
            ))}
            <button className="btn ghost" onClick={addLine} style={{ marginTop: 4 }}>+ Add procedure</button>
          </div>
          <div className="field">
            <label>Clinical notes</label>
            <textarea rows={3} value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)' }}>
            Each procedure's price will be charged to the patient's ledger automatically.
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save visit'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ----------------------------- Ledger ----------------------------- */
function LedgerTab({ patientId, onChanged }) {
  const [data, setData] = useState(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ type: 'PAYMENT', amount: '', method: 'CASH', note: '', planId: '' })
  const [plans, setPlans] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => get(`/patients/${patientId}/ledger`).then(setData).catch(() => {})
  useEffect(() => { load(); get(`/patients/${patientId}/plans`).then(setPlans).catch(() => {}) }, [patientId])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        type: form.type,
        amount: Number(form.amount),
        method: form.type === 'PAYMENT' ? form.method : null,
        note: form.note || null,
        planId: form.planId || null,
      }
      await post(`/patients/${patientId}/ledger`, body)
      setShow(false)
      setForm({ type: 'PAYMENT', amount: '', method: 'CASH', note: '', planId: '' })
      load()
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const sign = (e) => (e.type === 'CHARGE' ? '+' : '−')

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>Ledger</h2>
        <button className="btn" onClick={() => setShow(true)}>Add entry</button>
      </div>
      {!data || data.entries.length === 0 ? (
        <div className="empty">No charges or payments yet.</div>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Details</th><th>By</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id}>
                <td>{fmtDateTime(e.createdAt)}</td>
                <td>
                  <span className={`badge ${e.type === 'CHARGE' ? 'amber' : e.type === 'PAYMENT' ? 'green' : 'gray'}`}>
                    {e.type.toLowerCase()}
                  </span>
                </td>
                <td>
                  {e.note || '—'}
                  {e.plan && <span style={{ color: 'var(--ink-soft)' }}> · {e.plan.name}</span>}
                  {e.method && <span style={{ color: 'var(--ink-soft)' }}> · {e.method.replace('_', ' ').toLowerCase()}</span>}
                </td>
                <td>{e.author?.name ?? '—'}</td>
                <td className="num">{sign(e)}{peso(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
        Ledger entries can't be edited or deleted — record a correcting entry instead. This keeps the books auditable.
      </p>

      {show && (
        <Modal title="New ledger entry" onClose={() => setShow(false)}>
          <div className="form-grid">
            <div className="field">
              <label>Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                <option value="PAYMENT">Payment (patient paid)</option>
                <option value="CHARGE">Charge (patient owes)</option>
                <option value="DISCOUNT">Discount / adjustment</option>
              </select>
            </div>
            <div className="field">
              <label>Amount (₱)</label>
              <input type="number" min="0" value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            {form.type === 'PAYMENT' && (
              <div className="field">
                <label>Method</label>
                <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  <option value="CASH">Cash</option>
                  <option value="GCASH">GCash</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="CARD">Card</option>
                  <option value="HMO">HMO</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
            )}
            {plans.length > 0 && (
              <div className="field">
                <label>Apply to plan (optional)</label>
                <select value={form.planId} onChange={(e) => setForm((f) => ({ ...f, planId: e.target.value }))}>
                  <option value="">—</option>
                  {plans.filter((p) => p.status === 'ACTIVE').map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field full">
              <label>Note</label>
              <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. Monthly installment for June" />
            </div>
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={busy || !form.amount} onClick={save}>
              {busy ? 'Saving…' : 'Save entry'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ------------------------- Treatment plans ------------------------- */
function PlansTab({ patientId, onChanged }) {
  const [plans, setPlans] = useState([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ name: '', totalPrice: '', downpayment: '', monthlyDue: '', startDate: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = () => get(`/patients/${patientId}/plans`).then(setPlans).catch(() => {})
  useEffect(() => { load() }, [patientId])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        name: form.name,
        totalPrice: Number(form.totalPrice),
        downpayment: form.downpayment ? Number(form.downpayment) : null,
        monthlyDue: form.monthlyDue ? Number(form.monthlyDue) : null,
        startDate: form.startDate || null,
        notes: form.notes || null,
      }
      await post(`/patients/${patientId}/plans`, body)
      setShow(false)
      setForm({ name: '', totalPrice: '', downpayment: '', monthlyDue: '', startDate: '', notes: '' })
      load()
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>Treatment plans & packages</h2>
        <button className="btn" onClick={() => setShow(true)}>New plan</button>
      </div>
      {plans.length === 0 ? (
        <div className="empty">No treatment plans. Use these for braces packages and installment work.</div>
      ) : (
        plans.map((p) => {
          const pct = Math.min(100, Math.round((p.paid / Number(p.totalPrice)) * 100))
          return (
            <div key={p.id} style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{p.name}</strong>
                <StatusBadge value={p.status} />
              </div>
              <div style={{ fontSize: '.9rem', color: 'var(--ink-soft)', margin: '2px 0 6px' }}>
                Total {peso(p.totalPrice)}
                {p.monthlyDue && <> · {peso(p.monthlyDue)}/month</>}
                {p.startDate && <> · started {fmtDate(p.startDate)}</>}
              </div>
              <div style={{ background: 'var(--bg)', borderRadius: 99, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, background: 'var(--primary)', height: '100%' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.88rem', marginTop: 4 }}>
                <span style={{ color: 'var(--ok)' }}>Paid {peso(p.paid)}</span>
                <span style={{ color: p.remaining > 0 ? 'var(--money)' : 'var(--ok)', fontWeight: 600 }}>
                  Remaining {peso(p.remaining)}
                </span>
              </div>
            </div>
          )
        })
      )}

      {show && (
        <Modal title="New treatment plan" onClose={() => setShow(false)}>
          <div className="form-grid">
            <div className="field full">
              <label>Plan name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Metal Braces Package" />
            </div>
            <div className="field">
              <label>Total price (₱)</label>
              <input type="number" min="0" value={form.totalPrice}
                onChange={(e) => setForm((f) => ({ ...f, totalPrice: e.target.value }))} />
            </div>
            <div className="field">
              <label>Downpayment (₱, optional)</label>
              <input type="number" min="0" value={form.downpayment}
                onChange={(e) => setForm((f) => ({ ...f, downpayment: e.target.value }))} />
            </div>
            <div className="field">
              <label>Monthly due (₱, optional)</label>
              <input type="number" min="0" value={form.monthlyDue}
                onChange={(e) => setForm((f) => ({ ...f, monthlyDue: e.target.value }))} />
            </div>
            <div className="field">
              <label>Start date</label>
              <input type="date" value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="field full">
              <label>Notes</label>
              <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)' }}>
            The full price is charged to the ledger when the plan is created. Record the downpayment
            and monthly installments as payments applied to this plan.
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={busy || !form.name || !form.totalPrice} onClick={save}>
              {busy ? 'Saving…' : 'Create plan'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ------------------------------ Info ------------------------------ */
function InfoTab({ patient }) {
  const row = (label, value) => (
    <tr><th style={{ width: 180 }}>{label}</th><td>{value || '—'}</td></tr>
  )
  return (
    <div className="card">
      <h2>Patient information</h2>
      <table className="data" style={{ marginTop: 8 }}>
        <tbody>
          {row('Full name', fullName(patient))}
          {row('Birth date', patient.birthDate && fmtDate(patient.birthDate))}
          {row('Sex', patient.sex)}
          {row('Phone', patient.phone)}
          {row('Email', patient.email)}
          {row('Address', patient.address)}
          {row('Guardian', patient.guardianName && `${patient.guardianName} (${patient.guardianPhone || 'no phone'})`)}
          {row('Allergies', patient.allergies)}
          {row('Medical notes', patient.medicalNotes)}
          {row('Consent recorded', patient.consentSignedAt ? fmtDateTime(patient.consentSignedAt) : 'Not recorded')}
          {row('Registered', fmtDateTime(patient.createdAt))}
        </tbody>
      </table>
    </div>
  )
}
