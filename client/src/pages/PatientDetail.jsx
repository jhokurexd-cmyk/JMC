import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { get, post, patch, del, getBlob, postForm } from '../lib/api'
import { peso, fmtDate, fmtDateTime, fullName, initials, ageOf } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import Icon from '../components/Icon'
import { Loading, LoadError } from '../components/LoadState'
import { useToast } from '../components/Toast'
import StatusBadge from '../components/StatusBadge'
import FreebieRows, { normalizeFreebie } from '../components/FreebieRows'
import ProcedurePicker from '../components/ProcedurePicker'

const TAB_LABELS = {
  overview: 'Overview',
  visits: 'Visits',
  plans: 'Treatment / Braces plan',
  ledger: 'Ledger',
  payments: 'Payments',
  xrays: 'X-rays',
  info: 'Patient info',
}
const TAB_KEYS = Object.keys(TAB_LABELS)

export default function PatientDetail() {
  const { id } = useParams()
  const [patient, setPatient] = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const tab = TAB_KEYS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'visits'
  const setTab = (t) =>
    setSearchParams(
      (sp) => {
        sp.set('tab', t)
        if (t !== 'visits') sp.delete('fromAppt')
        return sp
      },
      { replace: true },
    )
  const fromAppt = searchParams.get('fromAppt')
  const fromApptDentist = searchParams.get('dentist')
  const clearFromAppt = () =>
    setSearchParams(
      (sp) => {
        sp.delete('fromAppt')
        sp.delete('dentist')
        return sp
      },
      { replace: true },
    )

  const [loadError, setLoadError] = useState(null)
  const load = useCallback(() => {
    setLoadError(null)
    return get(`/patients/${id}`).then(setPatient).catch(setLoadError)
  }, [id])
  useEffect(() => { setPatient(null); load() }, [load])

  // Header quick actions: jump to a tab and open its form (`new=1`).
  const openTabForm = (t) =>
    setSearchParams((sp) => {
      sp.set('tab', t)
      sp.set('new', '1')
      sp.delete('fromAppt')
      return sp
    }, { replace: true })
  const consumeNew = () => setSearchParams((sp) => { sp.delete('new'); return sp }, { replace: true })
  const wantsNew = searchParams.get('new') === '1'

  if (loadError && !patient) {
    return (
      <>
        <Link to="/patients" className="back-link"><Icon name="back" className="icon" />Patients</Link>
        <LoadError error={loadError.status === 404 ? { message: 'This patient record was not found.' } : loadError}
          onRetry={loadError.status === 404 ? undefined : load} />
      </>
    )
  }
  if (!patient) return <Loading />

  const balanceClass = patient.balance > 0 ? 'owed' : patient.balance < 0 ? 'credit' : 'clear'
  const balanceLabel = patient.balance < 0 ? 'Credit balance' : 'Total Due'
  const age = ageOf(patient.birthDate)

  return (
    <>
      <Link to="/patients" className="back-link"><Icon name="back" className="icon" />Patients</Link>
      <div className="page-head" style={{ alignItems: 'flex-start' }}>
        <div className="patient-head">
          <span className="avatar lg">{initials(patient)}</span>
          <div>
            <h1>{fullName(patient)}</h1>
            <div className="meta">
              <span>{patient.phone || 'no phone'}</span>
              <span>{patient.birthDate ? `${fmtDate(patient.birthDate)}${age != null ? ` · ${age} yrs` : ''}` : 'no birth date'}</span>
              {patient.guardianName && <span>Guardian: {patient.guardianName}</span>}
            </div>
          </div>
        </div>
        <div className="balance-box">
          <div className="label">{balanceLabel}</div>
          <div className={`balance-line ${balanceClass}`}>{peso(Math.abs(patient.balance))}</div>
        </div>
      </div>

      {patient.allergies && (
        <div className="alert-medical" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="alert" />Allergies: {patient.allergies}
        </div>
      )}

      <div className="quick-actions" style={{ marginBottom: 16 }}>
        <button className="btn" onClick={() => openTabForm('visits')}><Icon name="clipboard" />Record visit</button>
        <button className="btn ghost" onClick={() => openTabForm('payments')}><Icon name="cash" />Take payment</button>
        <Link className="btn ghost" to={`/appointments?new=1&patient=${id}`}><Icon name="calendar" />Book appointment</Link>
        <button className="btn quiet" onClick={() => window.open(`/patients/${id}/statement`, '_blank', 'noopener')}>
          <Icon name="printer" />Print statement
        </button>
      </div>

      <div className="tabs">
        {TAB_KEYS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && <PaymentOverviewTab patientId={id} />}
      {tab === 'visits' && (
        <VisitsTab patientId={id} onChanged={load} fromAppt={fromAppt}
          fromApptDentist={fromApptDentist} onConsumeAppt={clearFromAppt}
          wantsNew={wantsNew} onConsumeNew={consumeNew} />
      )}
      {tab === 'plans' && <PlansTab patientId={id} onChanged={load} />}
      {tab === 'ledger' && <LedgerTab patientId={id} onChanged={load} />}
      {tab === 'payments' && (
        <PaymentsTab patientId={id} onChanged={load} wantsNew={wantsNew} onConsumeNew={consumeNew} />
      )}
      {tab === 'xrays' && <XraysTab patientId={id} />}
      {tab === 'info' && <InfoTab patient={patient} onChanged={load} />}
    </>
  )
}

/* ----------------------- Payment overview ----------------------- */
function PaymentOverviewTab({ patientId }) {
  const [d, setD] = useState(null)
  useEffect(() => { get(`/patients/${patientId}/payment-overview`).then(setD).catch(() => {}) }, [patientId])
  if (!d) return <div className="empty">Loading…</div>

  const tile = (label, value, tone) => (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
    </div>
  )
  const methodLabel = (m) => (m ? m.replace('_', ' ').toLowerCase() : 'other')

  return (
    <>
      <div className="stat-row">
        {tile('Total Due', peso(d.totals.outstanding), d.totals.outstanding > 0 ? 'money' : 'ok')}
        {tile('Total charges', peso(d.totals.charges))}
        {tile('Total paid', peso(d.totals.paid), 'ok')}
      </div>
      <div className="stat-row">
        {tile('Total discounts', peso(d.totals.discounts))}
        {tile('Payments recorded', d.paymentCount)}
        {tile('Latest payment', d.latestPaymentDate ? fmtDate(d.latestPaymentDate) : '—')}
      </div>

      <div className="card">
        <h2>Braces / treatment packages</h2>
        {d.braces.plans.length === 0 ? (
          <div className="empty" style={{ padding: '14px 0' }}>No packages.</div>
        ) : (
          <>
            <div className="stat-row" style={{ marginBottom: 8 }}>
              {tile('Package total', peso(d.braces.packageTotal))}
              {tile('Paid to packages', peso(d.braces.paid), 'ok')}
              {tile('Remaining', peso(d.braces.remaining), d.braces.remaining > 0 ? 'money' : 'ok')}
            </div>
            <table className="data">
              <thead>
                <tr><th>Package</th><th>Status</th><th className="num">Price</th><th className="num">Paid</th><th className="num">Remaining</th></tr>
              </thead>
              <tbody>
                {d.braces.plans.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td><StatusBadge value={p.status} /></td>
                    <td className="num">{peso(p.totalPrice)}</td>
                    <td className="num">{peso(p.paid)}</td>
                    <td className="num">{peso(p.remaining)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="form-grid" style={{ gap: 16 }}>
        <div className="card">
          <h2>Payments by procedure / package</h2>
          {d.byTarget.length === 0 ? (
            <div className="empty" style={{ padding: '14px 0' }}>No payments yet.</div>
          ) : (
            <table className="data">
              <thead><tr><th>For</th><th className="num">#</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {d.byTarget.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label} {r.kind === 'package' && <span className="badge teal">package</span>}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{peso(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Payments by method</h2>
          {d.byMethod.length === 0 ? (
            <div className="empty" style={{ padding: '14px 0' }}>No payments yet.</div>
          ) : (
            <table className="data">
              <thead><tr><th>Method</th><th className="num">#</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {d.byMethod.map((r) => (
                  <tr key={r.method}><td>{methodLabel(r.method)}</td><td className="num">{r.count}</td><td className="num">{peso(r.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Recent payments</h2>
        {d.recentPayments.length === 0 ? (
          <div className="empty" style={{ padding: '14px 0' }}>No payments yet.</div>
        ) : (
          <table className="data">
            <thead><tr><th>Date</th><th>For</th><th>Method</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {d.recentPayments.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDateTime(p.date)}</td>
                  <td>{p.forLabel}</td>
                  <td>{methodLabel(p.method)}</td>
                  <td className="num">{peso(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
        Read-only summary. Braces adjustment charges are covered by the package price, so they
        don&rsquo;t add to Total Due — only paying them lowers the package remaining.
        Charges are on the <strong>Ledger</strong> tab; receipts, voids and refunds on <strong>Payments</strong>.
      </p>
    </>
  )
}

/* ----------------------------- Visits ----------------------------- */
const newVisitForm = () => ({
  visitDate: new Date().toISOString().slice(0, 10), notes: '', nextVisitDate: '', performedBy: '',
})
const fInput = { border: '1px solid var(--line)', borderRadius: 6, padding: '6px 8px', width: 100 }
const today = () => new Date().toISOString().slice(0, 10)
const blankLine = (performedBy = '') => ({
  procedureId: '', coveredByPlanId: '', coveredByFreebieId: '', performedBy,
  items: [{ price: '', covered: false }],
})
const num = (v) => Number(v) || 0
const lineBillable = (l) => l.items.reduce((s, it) => s + (it.covered ? 0 : num(it.price)), 0)
const lineCoveredCount = (l) => l.items.filter((it) => it.covered).length

function VisitsTab({ patientId, onChanged, fromAppt, fromApptDentist, onConsumeAppt, wantsNew, onConsumeNew }) {
  const toast = useToast()
  const [visits, setVisits] = useState([])
  const [catalog, setCatalog] = useState([])
  const [plans, setPlans] = useState([])
  const [performers, setPerformers] = useState([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState(newVisitForm())
  const [lines, setLines] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const apptHandled = useRef(false)

  const load = () => get(`/patients/${patientId}/visits`).then(setVisits).catch(() => {})
  const loadPlans = () => get(`/patients/${patientId}/plans`).then(setPlans).catch(() => {})
  useEffect(() => {
    load()
    loadPlans()
    get('/procedures').then(setCatalog).catch(() => {})
    get('/visit-performers').then(setPerformers).catch(() => {})
  }, [patientId])

  const openForm = (performedBy = '') => {
    setShow(true)
    setLines((l) => (l.length === 0 ? [blankLine(performedBy)] : l))
  }

  // Deep-linked from an appointment ("Record visit"): open the form once,
  // prefilled with the appointment's dentist and its date.
  useEffect(() => {
    if (fromAppt && !apptHandled.current) {
      apptHandled.current = true
      if (fromApptDentist) setForm((f) => ({ ...f, performedBy: fromApptDentist }))
      get(`/appointments?from=1970-01-01&to=2999-01-01`)
        .then((rows) => {
          const a = rows.find((x) => x.id === fromAppt)
          const day = a?.startsAt ? String(a.startsAt).slice(0, 10) : ''
          if (day) setForm((f) => ({ ...f, visitDate: day > today() ? today() : day }))
        })
        .catch(() => {})
      openForm(fromApptDentist || '')
    }
  }, [fromAppt])

  useEffect(() => {
    if (wantsNew) {
      openForm()
      onConsumeNew()
    }
  }, [wantsNew])

  const activePlans = plans.filter((p) => p.status === 'ACTIVE')
  const installmentPlans = activePlans.filter((p) => p.paymentType === 'INSTALLMENT')
  const planOf = (id) => activePlans.find((p) => p.id === id)
  const procOf = (id) => catalog.find((c) => c.id === id)

  // The "part of the package" option is ONLY for a Braces Adjustment.
  const isAdjustment = (procedureId) => /adjustment/i.test(procOf(procedureId)?.name || '')
  const autoPlanId = (procedureId) =>
    installmentPlans.length && isAdjustment(procedureId) ? installmentPlans[0].id : ''

  // An available package benefit (freebie) that covers this procedure, if any.
  const freebieFor = (procedureId) => {
    for (const p of activePlans) {
      for (const f of p.freebies ?? []) {
        if (f.procedureId === procedureId && f.remaining > 0) return { ...f, planName: p.name }
      }
    }
    return null
  }

  const addLine = () => setLines((l) => [...l, blankLine(form.performedBy)])
  const removeLine = (i) => setLines((l) => l.filter((_, idx) => idx !== i))
  const patchLine = (i, patch) => setLines((l) => l.map((ln, idx) => (idx === i ? { ...ln, ...patch } : ln)))

  const pickProcedure = (i, procedureId) => {
    const proc = procOf(procedureId)
    const auto = autoPlanId(procedureId)
    const startPrice = auto ? (planOf(auto)?.monthlyDue ?? proc?.defaultPrice ?? '') : (proc?.defaultPrice ?? '')
    patchLine(i, {
      procedureId,
      coveredByPlanId: auto,
      coveredByFreebieId: '',
      items: [{ price: startPrice, covered: false }],
    })
  }
  const setAdjustmentMode = (i, planId) => {
    const ln = lines[i]
    const proc = procOf(ln.procedureId)
    const price = ln.items[0]?.price || (planId ? planOf(planId)?.monthlyDue : proc?.defaultPrice) || ''
    patchLine(i, { coveredByPlanId: planId, items: [{ price, covered: false }] })
  }
  const setQty = (i, n) => {
    const ln = lines[i]
    const base = procOf(ln.procedureId)?.defaultPrice ?? ''
    const items = Array.from({ length: Math.max(1, n) }, (_, j) => ln.items[j] ?? { price: base, covered: false })
    patchLine(i, { items })
  }
  const setItemPrice = (i, j, v) =>
    patchLine(i, { items: lines[i].items.map((it, idx) => (idx === j ? { ...it, price: v } : it)) })
  const toggleItemFree = (i, j) => {
    const ln = lines[i]
    const fb = freebieFor(ln.procedureId)
    const willCheck = !ln.items[j].covered
    if (willCheck && (!fb || lineCoveredCount(ln) >= fb.remaining)) return
    const items = ln.items.map((it, idx) => (idx === j ? { ...it, covered: willCheck } : it))
    patchLine(i, { items, coveredByFreebieId: items.some((it) => it.covered) ? fb?.id ?? '' : '' })
  }

  const filled = lines.filter((l) => l.procedureId)
  const chargeTotal = filled.reduce((s, l) => s + (l.coveredByPlanId ? 0 : lineBillable(l)), 0)
  const adjTotal = filled.reduce((s, l) => s + (l.coveredByPlanId ? lineBillable(l) : 0), 0)
  const lineError = (l) => {
    if (l.coveredByPlanId) {
      const rem = planOf(l.coveredByPlanId)?.remaining
      if (rem != null && lineBillable(l) > rem) return `more than the ${peso(rem)} left on this package`
    }
    const covered = lineCoveredCount(l)
    if (covered > 0) {
      const fb = freebieFor(l.procedureId)
      if (!fb) return 'no free benefit available for this procedure'
      if (covered > fb.remaining) return `only ${fb.remaining} free ${fb.name} left`
    }
    return ''
  }
  const anyInvalid = filled.some((l) => lineError(l))

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await post(`/patients/${patientId}/visits`, {
        visitDate: form.visitDate,
        notes: form.notes || null,
        nextVisitDate: form.nextVisitDate || null,
        appointmentId: fromAppt || null,
        chargeToLedger: true,
        procedures: filled.map((l) => ({
          procedureId: l.procedureId,
          quantity: l.items.length,
          items: l.items.map((it) => ({ price: num(it.price), covered: !!it.covered })),
          coveredByPlanId: l.coveredByPlanId || null,
          coveredByFreebieId: lineCoveredCount(l) > 0 ? l.coveredByFreebieId || null : null,
          performedBy: (l.performedBy || '').trim() || null,
        })),
      })
      setShow(false)
      setLines([])
      setForm(newVisitForm())
      toast(chargeTotal > 0 ? `Visit recorded · ${peso(chargeTotal)} charged` : 'Visit recorded')
      onConsumeAppt?.()
      load()
      loadPlans()
      get('/visit-performers').then(setPerformers).catch(() => {})
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
        <button className="btn" onClick={() => openForm()}>Record visit</button>
      </div>
      {visits.length === 0 ? (
        <div className="empty">No visits recorded yet.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th><th>Procedure</th><th>Performed by</th>
              <th className="num">Price</th>
            </tr>
          </thead>
          <tbody>
            {visits.map((v) => {
              const procRows = v.procedures.length > 0 ? v.procedures : [null]
              return procRows.map((p, idx) => (
                <tr key={p ? p.id : v.id}>
                  {idx === 0 && (
                    <td rowSpan={procRows.length} style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {fmtDate(v.visitDate)}
                      {v.nextVisitDate && (
                        <div className="badge teal" style={{ marginTop: 4 }}>
                          Next {fmtDate(v.nextVisitDate)}
                        </div>
                      )}
                      {v.notes && (
                        <div style={{ color: 'var(--ink-soft)', fontSize: '.8rem', marginTop: 4, whiteSpace: 'normal', maxWidth: 220 }}>
                          {v.notes}
                        </div>
                      )}
                    </td>
                  )}
                  {p ? (
                    <>
                      <td>
                        {p.procedure.name}
                        {p.quantity > 1 && <span style={{ color: 'var(--ink-soft)' }}> ×{p.quantity}</span>}
                        {p.coveredByPlan && (
                          <span style={{ color: 'var(--ink-soft)' }}> · {p.coveredByPlan.name} adjustment</span>
                        )}
                        {p.coveredByFreebie && (
                          <span style={{ color: 'var(--ink-soft)' }}>
                            {' '}· {(Array.isArray(p.items) ? p.items.filter((it) => it.covered).length : 0)} free ({p.coveredByFreebie.name})
                          </span>
                        )}
                      </td>
                      <td>{p.performedBy || <span style={{ color: 'var(--ink-soft)' }}>—</span>}</td>
                      <td className="num" style={{ color: Number(p.priceCharged) === 0 ? 'var(--ink-soft)' : 'inherit' }}>
                        {Number(p.priceCharged) === 0 ? '—' : peso(p.priceCharged)}
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} style={{ color: 'var(--ink-soft)' }}>No procedures recorded</td>
                  )}
                </tr>
              ))
            })}
          </tbody>
        </table>
      )}

      {show && (
        <Modal title="Record visit" onClose={() => setShow(false)} busy={busy}>
          <div className="form-grid">
            <div className="field">
              <label>Visit date</label>
              <input type="date" max={today()} value={form.visitDate}
                onChange={(e) => setForm((f) => ({ ...f, visitDate: e.target.value }))} />
            </div>
            <div className="field">
              <label>Next visit (optional)</label>
              <input type="date" min={form.visitDate || today()} value={form.nextVisitDate}
                onChange={(e) => setForm((f) => ({ ...f, nextVisitDate: e.target.value }))} />
            </div>
            <div className="field full">
              <label>Performed by (default for procedures below)</label>
              <input list="visit-performers" placeholder="e.g. Dr. Cruz" value={form.performedBy}
                onChange={(e) => setForm((f) => ({ ...f, performedBy: e.target.value }))} />
            </div>
          </div>
          <datalist id="visit-performers">
            {performers.map((n) => <option key={n} value={n} />)}
          </datalist>
          <div className="field">
            <label>Procedures done</label>
            {lines.map((line, i) => {
              const proc = procOf(line.procedureId)
              const fb = line.procedureId ? freebieFor(line.procedureId) : null
              const multi = proc?.allowQuantity
              const coveredN = lineCoveredCount(line)
              return (
                <div key={i} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={line.procedureId} onChange={(e) => pickProcedure(i, e.target.value)}
                      style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }}>
                      <option value="">Select procedure…</option>
                      {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button className="btn quiet" onClick={() => removeLine(i)} title="Remove">✕</button>
                  </div>

                  {line.procedureId && (
                    <div style={{ marginTop: 6, fontSize: '.85rem' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', color: 'var(--ink-soft)' }}>
                        {installmentPlans.length > 0 && isAdjustment(line.procedureId) && (
                          <select value={line.coveredByPlanId} onChange={(e) => setAdjustmentMode(i, e.target.value)}
                            style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '5px 6px' }}>
                            <option value="">Charge to patient</option>
                            {installmentPlans.map((p) => (
                              <option key={p.id} value={p.id}>Part of {p.name} (adjustment)</option>
                            ))}
                          </select>
                        )}
                        {multi && !line.coveredByPlanId && (
                          <label style={{ color: 'var(--ink)' }}>
                            Qty
                            <input type="number" min="1" value={line.items.length}
                              onChange={(e) => setQty(i, Math.max(1, Number(e.target.value) || 1))}
                              style={{ ...fInput, width: 60, marginLeft: 4 }} />
                          </label>
                        )}
                        <label style={{ color: 'var(--ink)' }}>
                          By
                          <input list="visit-performers" placeholder="dentist" value={line.performedBy}
                            onChange={(e) => patchLine(i, { performedBy: e.target.value })}
                            style={{ ...fInput, width: 130, marginLeft: 4 }} />
                        </label>
                      </div>

                      {/* per-item prices + free checkboxes */}
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {line.items.map((it, j) => (
                          <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ color: 'var(--ink-soft)', minWidth: multi ? 58 : 0 }}>
                              {multi ? `#${j + 1}` : (line.coveredByPlanId ? 'Adjustment' : 'Price')}
                            </span>
                            <span style={{ color: 'var(--ink)' }}>₱
                              <input type="number" min="0" value={it.price}
                                onChange={(e) => setItemPrice(i, j, e.target.value)}
                                style={{ ...fInput, marginLeft: 2 }} />
                            </span>
                            {fb && !line.coveredByPlanId && (
                              <label className="check" style={{ margin: 0 }}>
                                <input type="checkbox" checked={it.covered}
                                  disabled={!it.covered && coveredN >= fb.remaining}
                                  onChange={() => toggleItemFree(i, j)} />
                                <span style={{ fontSize: '.8rem' }}>free ({fb.name})</span>
                              </label>
                            )}
                          </div>
                        ))}
                      </div>

                      <div style={{ marginTop: 4, color: 'var(--ink-soft)' }}>
                        {line.coveredByPlanId ? (
                          <>→ {planOf(line.coveredByPlanId)?.name} · {peso(planOf(line.coveredByPlanId)?.remaining)} left · doesn&rsquo;t add to Total Due</>
                        ) : (
                          <>Charge: <strong>{peso(lineBillable(line))}</strong>
                            {coveredN > 0 && <> · {coveredN} free from {fb?.name} · doesn&rsquo;t affect the package balance</>}
                            {fb && <> · {fb.remaining} free {fb.name} available</>}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                  {lineError(line) && <div className="err" style={{ marginTop: 4 }}>{lineError(line)}</div>}
                </div>
              )
            })}
            <button className="btn ghost" onClick={addLine} style={{ marginTop: 8 }}>+ Add procedure</button>
          </div>
          <div className="field">
            <label>Clinical notes</label>
            <textarea rows={3} value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)' }}>
            {chargeTotal > 0 && <>Adds {peso(chargeTotal)} in charges to Total Due. </>}
            {adjTotal > 0 && (
              <>The {peso(adjTotal)} braces adjustment goes to the ledger <strong>Unpaid</strong> but
              does <strong>not</strong> add to Total Due — mark it <strong>Paid</strong> on the
              <strong> Ledger</strong> tab to deduct it from the package balance.</>
            )}
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn"
              disabled={busy || anyInvalid || (filled.length === 0 && !form.notes.trim())}
              onClick={save}>
              {busy ? 'Saving…' : 'Save visit'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ----------------------------- Ledger ----------------------------- */
// Charges & balances. Payments live on their own tab — the only payment action
// here is "Mark paid" on an open charge (which records a payment against it).
const blankLedgerForm = () => ({ type: 'CHARGE', amount: '', method: 'CASH', note: '', target: '' })

function LedgerTab({ patientId, onChanged }) {
  const [data, setData] = useState(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState(blankLedgerForm())
  const [plans, setPlans] = useState([])
  const [busy, setBusy] = useState(false)
  const [openDetail, setOpenDetail] = useState({})
  const [error, setError] = useState('')

  const load = () => get(`/patients/${patientId}/ledger`).then(setData).catch(() => {})
  const loadPlans = () => get(`/patients/${patientId}/plans`).then(setPlans).catch(() => {})
  useEffect(() => { load(); loadPlans() }, [patientId])

  const activePlans = plans.filter((p) => p.status === 'ACTIVE')
  const openCharges = data?.openCharges ?? []
  const rows = (data?.entries ?? []).filter((e) => e.type === 'CHARGE' || e.type === 'DISCOUNT')

  const targetRemaining = form.target.startsWith('charge:')
    ? openCharges.find((c) => c.id === form.target.slice(7))?.remaining ?? null
    : null
  const amount = Number(form.amount)
  const over = targetRemaining != null && amount > targetRemaining

  const openModal = (preset = {}) => { setForm({ ...blankLedgerForm(), ...preset }); setError(''); setShow(true) }

  const save = async () => {
    if (form.type === 'PAYMENT' && !confirm(`Record a ${peso(amount)} payment to settle this charge? A receipt is issued; it can only be undone with a void or refund.`)) return
    setBusy(true)
    setError('')
    try {
      await post(`/patients/${patientId}/ledger`, {
        type: form.type,
        amount,
        method: form.type === 'PAYMENT' ? form.method : null,
        note: form.note || null,
        appliesToId: form.target.startsWith('charge:') ? form.target.slice(7) : null,
      })
      setShow(false)
      setForm(blankLedgerForm())
      load(); loadPlans(); onChanged()
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
        <button className="btn ghost" onClick={() => openModal({ type: 'CHARGE' })}>Add charge / discount</button>
      </div>

      {activePlans.filter((p) => p.remaining > 0).map((p) => (
        <p key={p.id} style={{ fontSize: '.85rem', color: 'var(--ink-soft)', margin: '0 0 10px' }}>
          <strong>{p.name}</strong> — {peso(p.remaining)} of {peso(p.totalPrice)} left
          {p.monthlyDue ? ` · ${peso(p.monthlyDue)}/mo adjustment` : ''}. Marking a
          <strong> {p.name} adjustment</strong> charge Paid below deducts it from this balance.
        </p>
      ))}

      {rows.length === 0 ? (
        <div className="empty">No charges yet.</div>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Date</th><th>Type</th><th>Details</th><th>By</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const legacyPlanCharge = e.planId && (e.note ?? '').startsWith('Treatment plan:')
              const showPayState = e.type === 'CHARGE' && e.payStatus && !legacyPlanCharge && !e.voided
              const vp = e.visitProcedure
              const vpItems = vp && Array.isArray(vp.items) ? vp.items : null
              const detailOpen = !!openDetail[e.id]
              return (
                <Fragment key={e.id}>
                <tr className={e.voided ? 'row-voided' : undefined}>
                  <td>{fmtDateTime(e.createdAt)}</td>
                  <td>
                    <span className={`badge ${e.type === 'CHARGE' ? 'amber' : 'gray'}`}>{e.type.toLowerCase()}</span>
                    {e.voided && <span className="badge gray" style={{ marginLeft: 6 }}>voided</span>}
                  </td>
                  <td>
                    {e.note || '—'}
                    {e.plan && <span style={{ color: 'var(--ink-soft)' }}> · {e.plan.name}</span>}
                    {showPayState && (
                      e.payStatus === 'PAID'
                        ? <span className="badge green" style={{ marginLeft: 8 }}>paid</span>
                        : <>
                            <span className="badge amber" style={{ marginLeft: 8 }}>
                              {e.payStatus === 'PARTIAL' ? `${peso(e.remaining)} left` : 'unpaid'}
                            </span>
                            <button className="btn quiet" style={{ marginLeft: 8, padding: '2px 10px', fontSize: '.8rem' }}
                              onClick={() => openModal({
                                type: 'PAYMENT',
                                target: `charge:${e.id}`,
                                amount: String(e.remaining),
                                note: e.planId ? 'Adjustment payment' : '',
                              })}>
                              Mark paid
                            </button>
                          </>
                    )}
                    {vpItems && vpItems.length > 1 && (
                      <button className="btn quiet" style={{ marginLeft: 8, padding: '2px 10px', fontSize: '.8rem' }}
                        onClick={() => setOpenDetail((o) => ({ ...o, [e.id]: !o[e.id] }))}>
                        {detailOpen ? 'Hide items' : 'Items'}
                      </button>
                    )}
                  </td>
                  <td>{e.author?.name ?? '—'}</td>
                  <td className="num">{sign(e)}{peso(e.amount)}</td>
                </tr>
                {detailOpen && vpItems && (
                  <tr style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
                    <td></td>
                    <td colSpan={4}>
                      {vp.procedure?.name} — {vpItems.length} performed
                      {vp.coveredByFreebie && `, ${vpItems.filter((it) => it.covered).length} free (${vp.coveredByFreebie.name})`}
                      <div style={{ marginTop: 2 }}>
                        {vpItems.map((it, k) => (
                          <span key={k} style={{ marginRight: 10 }}>
                            #{k + 1} {peso(it.price)}{it.covered ? ' (free)' : ''}
                          </span>
                        ))}
                      </div>
                      <div>Paid: {vpItems.filter((it) => !it.covered).length} · Ledger charge {peso(vp.priceCharged)}</div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
        Charges can't be edited or deleted — record a correcting discount instead. Payment transactions
        (receipts, voids, refunds) are on the <strong>Payments</strong> tab.
      </p>

      {show && (
        <Modal title={form.type === 'PAYMENT' ? 'Mark charge paid' : 'Add charge / discount'} onClose={() => setShow(false)} busy={busy}>
          <div className="form-grid">
            {form.type !== 'PAYMENT' && (
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="CHARGE">Charge (patient owes)</option>
                  <option value="DISCOUNT">Discount / adjustment</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Amount (₱)</label>
              <input type="number" min="0" max={targetRemaining ?? undefined} value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              {over && <span className="err">Can't exceed the {peso(targetRemaining)} still owed</span>}
            </div>
            {form.type === 'PAYMENT' && (
              <div className="field">
                <label>Method</label>
                <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )}
            <div className="field full">
              <label>Note</label>
              <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. Senior discount" />
            </div>
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={busy || !form.amount || amount <= 0 || over} onClick={save}>
              {busy ? 'Saving…' : form.type === 'PAYMENT' ? 'Record payment' : 'Save entry'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ---------------------------- Payments ---------------------------- */
function PaymentsTab({ patientId, onChanged, wantsNew, onConsumeNew }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [plans, setPlans] = useState([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ amount: '', method: 'CASH', note: '', target: '' })
  const [busy, setBusy] = useState(false)
  const [actId, setActId] = useState(null)
  const [refundFor, setRefundFor] = useState(null)
  const [error, setError] = useState('')

  const load = () => get(`/patients/${patientId}/ledger`).then(setData).catch(() => {})
  const loadPlans = () => get(`/patients/${patientId}/plans`).then(setPlans).catch(() => {})
  useEffect(() => { load(); loadPlans() }, [patientId])

  const openPayment = () => {
    setForm({ amount: '', method: 'CASH', note: '', target: '' })
    setError('')
    setShow(true)
  }
  useEffect(() => {
    if (wantsNew) {
      openPayment()
      onConsumeNew()
    }
  }, [wantsNew])

  const activePlans = plans.filter((p) => p.status === 'ACTIVE')
  const payments =(data?.entries ?? []).filter((e) => e.type === 'PAYMENT' && !e.isReversal)
  const amount = Number(form.amount)
  const planRemaining = form.target.startsWith('plan:')
    ? activePlans.find((p) => p.id === form.target.slice(5))?.remaining ?? null
    : null
  const over = planRemaining != null && amount > planRemaining

  const save = async () => {
    if (!confirm(`Record a ${peso(amount)} payment? A receipt is issued.`)) return
    setBusy(true); setError('')
    try {
      const entry = await post(`/patients/${patientId}/ledger`, {
        type: 'PAYMENT',
        amount,
        method: form.method,
        note: form.note || null,
        planId: form.target.startsWith('plan:') ? form.target.slice(5) : null,
      })
      setShow(false)
      setForm({ amount: '', method: 'CASH', note: '', target: '' })
      toast(`Payment of ${peso(amount)} recorded${entry?.receiptNo ? ` · ${entry.receiptNo}` : ''}`)
      load(); loadPlans(); onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const voidPayment = async (p) => {
    if (!confirm(`Void receipt ${p.receiptNo || ''} (${peso(p.amount)})? Use this when the payment was recorded by mistake.`)) return
    const reason = prompt('Reason for the void:', '') ?? ''
    setActId(p.id); setError('')
    try {
      await post(`/patients/${patientId}/ledger/${p.id}/void`, { reason: reason.trim() || null })
      load(); loadPlans(); onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setActId(null)
    }
  }

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>Payments</h2>
        <button className="btn" onClick={openPayment}>Record payment</button>
      </div>

      {payments.length === 0 ? (
        <div className="empty">No payments recorded yet.</div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Receipt #</th><th>Date</th><th>For</th><th>Method</th>
              <th>By</th><th>Status</th><th className="num">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const forLabel = p.plan?.name
                || (p.appliesTo?.note ? `Charge · ${p.appliesTo.note}` : null)
                || (p.visitProcedure?.procedure?.name ? `Visit · ${p.visitProcedure.procedure.name}` : null)
                || 'General'
              const live = p.paymentStatus === 'PAID'
              return (
                <tr key={p.id} className={live ? undefined : 'row-voided'}>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.receiptNo || '—'}</td>
                  <td>{fmtDateTime(p.createdAt)}</td>
                  <td>{forLabel}{p.note && <span style={{ color: 'var(--ink-soft)' }}> · {p.note}</span>}</td>
                  <td>{(p.method || 'other').replace('_', ' ').toLowerCase()}</td>
                  <td>{p.author?.name ?? '—'}</td>
                  <td><StatusBadge value={p.paymentStatus || 'PAID'} /></td>
                  <td className="num">{peso(p.amount)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn quiet" style={{ padding: '2px 8px', fontSize: '.78rem' }}
                      onClick={() => window.open(`/patients/${patientId}/receipt/${p.id}`, '_blank', 'noopener')}>
                      Print
                    </button>{' '}
                    {live && (
                      <>
                        <button className="btn quiet" style={{ padding: '2px 8px', fontSize: '.78rem' }}
                          disabled={actId === p.id} onClick={() => voidPayment(p)}>
                          {actId === p.id ? '…' : 'Void'}
                        </button>{' '}
                        <button className="btn quiet" style={{ padding: '2px 8px', fontSize: '.78rem' }}
                          onClick={() => setRefundFor(p)}>Refund</button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
        <strong>Void</strong> = the payment was recorded by mistake. <strong>Refund</strong> = the money was
        returned to the patient. Both keep the record and correct the balance and income.
      </p>

      {show && (
        <Modal title="Record payment" onClose={() => setShow(false)} busy={busy}>
          <div className="form-grid">
            <div className="field">
              <label>Amount (₱)</label>
              <input type="number" min="0" max={planRemaining ?? undefined} value={form.amount} autoFocus
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              {over && <span className="err">Can't exceed the {peso(planRemaining)} left on the package</span>}
            </div>
            <div className="field">
              <label>Method</label>
              <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {activePlans.length > 0 && (
              <div className="field">
                <label>Apply to</label>
                <select value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}>
                  <option value="">— general (whole balance) —</option>
                  {activePlans.map((p) => (
                    <option key={p.id} value={`plan:${p.id}`}>{p.name} · {peso(p.remaining)} left</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field full">
              <label>Note</label>
              <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. Downpayment" />
            </div>
          </div>
          <p style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
            To settle a specific unpaid charge, use <strong>Mark paid</strong> on the Ledger tab instead.
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={busy || !form.amount || amount <= 0 || over} onClick={save}>
              {busy ? 'Saving…' : 'Record payment'}
            </button>
          </div>
        </Modal>
      )}

      {refundFor && (
        <RefundModal patientId={patientId} payment={refundFor}
          onClose={() => setRefundFor(null)}
          onDone={() => { setRefundFor(null); load(); loadPlans(); onChanged() }} />
      )}
    </div>
  )
}

function RefundModal({ patientId, payment, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState(payment.method || 'CASH')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!confirm(`Refund ${peso(payment.amount)} from receipt ${payment.receiptNo || ''}?`)) return
    setBusy(true); setError('')
    try {
      await post(`/patients/${patientId}/ledger/${payment.id}/refund`, { reason: reason.trim(), method })
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Refund — ${payment.receiptNo || peso(payment.amount)}`} onClose={onClose} busy={busy}>
      <p style={{ fontSize: '.88rem', color: 'var(--ink-soft)', marginTop: 0 }}>
        Refunding returns {peso(payment.amount)} to the patient. Net income drops and any charge this
        payment settled goes back to owed. The receipt is kept and marked <strong>Refunded</strong>.
      </p>
      <div className="form-grid">
        <div className="field">
          <label>Returned by</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="field full">
        <label>Reason *</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Treatment cancelled, overpayment" />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
      <div className="actions">
        <button className="btn quiet" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !reason.trim()} onClick={save}>
          {busy ? 'Saving…' : 'Refund'}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------- Treatment plans ------------------------- */
const PAYMENT_METHODS = [
  ['CASH', 'Cash'], ['GCASH', 'GCash'], ['BANK_TRANSFER', 'Bank transfer'],
  ['CARD', 'Card'], ['HMO', 'HMO'], ['OTHER', 'Other'],
]
const newPlanForm = () => ({
  name: '', templateId: '', paymentType: 'CASH', totalPrice: '',
  downpayment: '', downpaymentMethod: 'CASH', monthlyDue: '', startDate: '', notes: '',
  freebies: [], includedProcedures: [],
})

function PlansTab({ patientId, onChanged }) {
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const [plans, setPlans] = useState([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState(newPlanForm())
  const [packages, setPackages] = useState([])
  const [catalog, setCatalog] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [payFor, setPayFor] = useState(null) // plan being paid
  const [editFor, setEditFor] = useState(null) // plan being edited
  const [openHistory, setOpenHistory] = useState({})
  const [benefitAction, setBenefitAction] = useState(null) // { plan, freebie, mode: 'void'|'restore' }

  const load = () => get(`/patients/${patientId}/plans`).then(setPlans).catch(() => {})
  useEffect(() => {
    load()
    get('/packages').then(setPackages).catch(() => {})
    get('/procedures').then(setCatalog).catch(() => {})
  }, [patientId])

  const isInstallment = form.paymentType === 'INSTALLMENT'

  const applyTemplate = (templateId) => {
    const t = packages.find((p) => p.id === templateId)
    if (!t) { setForm((f) => ({ ...f, templateId: '' })); return }
    setForm((f) => ({
      ...f,
      templateId,
      name: t.name,
      paymentType: t.paymentType,
      totalPrice: String(t.defaultPrice),
      downpayment: t.downpayment != null ? String(t.downpayment) : '',
      monthlyDue: t.monthlyDue != null ? String(t.monthlyDue) : '',
      freebies: (Array.isArray(t.freebies) ? t.freebies : []).map(normalizeFreebie),
      includedProcedures: t.procedures.map((x) => ({ procedureId: x.procedureId, name: x.name })),
    }))
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        name: form.name,
        templateId: form.templateId || null,
        paymentType: form.paymentType,
        totalPrice: Number(form.totalPrice),
        startDate: form.startDate || null,
        notes: form.notes || null,
        freebies: form.freebies
          .filter((x) => (x.name || '').trim())
          .map((x) => ({
            name: x.name.trim(),
            procedureId: x.procedureId || null,
            qtyIncluded: Math.max(1, Number(x.qtyIncluded) || 1),
            notes: (x.notes || '').trim() || null,
          })),
        includedProcedures: form.includedProcedures
          .filter((x) => x.name.trim())
          .map((x) => ({ procedureId: x.procedureId || null, name: x.name.trim() })),
        ...(isInstallment
          ? {
              downpayment: Number(form.downpayment),
              downpaymentMethod: form.downpaymentMethod,
              monthlyDue: Number(form.monthlyDue),
            }
          : {}),
      }
      await post(`/patients/${patientId}/plans`, body)
      setShow(false)
      setForm(newPlanForm())
      load()
      onChanged()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const planClosed = form.paymentType === 'INSTALLMENT' && (!form.downpayment || !form.monthlyDue)

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
          const histOpen = !!openHistory[p.id]
          return (
            <div key={p.id} style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <strong>{p.name}</strong>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge teal">
                    {p.paymentType === 'INSTALLMENT' ? 'Installment' : 'Cash'}
                  </span>
                  <StatusBadge value={p.status} />
                </span>
              </div>
              <div style={{ fontSize: '.9rem', color: 'var(--ink-soft)', margin: '2px 0 6px' }}>
                Package price {peso(p.totalPrice)}
                {p.monthlyDue && <> · {peso(p.monthlyDue)}/mo adjustment</>}
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
              {Array.isArray(p.includedProcedures) && p.includedProcedures.length > 0 && (
                <div style={{ fontSize: '.85rem', color: 'var(--ink-soft)', marginTop: 8 }}>
                  Includes: {p.includedProcedures.map((x) => x.name).join(' · ')}
                </div>
              )}
              {Array.isArray(p.freebies) && p.freebies.length > 0 && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 4 }}>
                    Package benefits
                  </div>
                  <table className="data">
                    <tbody>
                      {p.freebies.map((f) => (
                        <FreebieRow key={f.id} plan={p} freebie={f} isOwner={isOwner}
                          onAct={(mode) => setBenefitAction({ plan: p, freebie: f, mode })} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {p.status === 'ACTIVE' && (
                  <button className="btn ghost" onClick={() => setPayFor(p)}>Record payment</button>
                )}
                {p.status !== 'CANCELLED' && (
                  <button className="btn quiet" onClick={() => setEditFor(p)}>Edit package</button>
                )}
                <button
                  className="btn quiet"
                  onClick={() => setOpenHistory((o) => ({ ...o, [p.id]: !o[p.id] }))}
                >
                  {histOpen ? 'Hide' : 'History'} ({p.payments.length})
                </button>
              </div>
              {histOpen && (
                p.payments.length === 0 ? (
                  <div className="empty" style={{ padding: '10px 0' }}>Nothing billed or paid yet.</div>
                ) : (
                  <table className="data" style={{ marginTop: 8 }}>
                    <thead>
                      <tr><th>Date</th><th>Type</th><th>Note</th><th>By</th><th className="num">Amount</th></tr>
                    </thead>
                    <tbody>
                      {p.payments.map((e) => (
                        <tr key={e.id}>
                          <td>{fmtDateTime(e.createdAt)}</td>
                          <td>
                            <span className={`badge ${e.type === 'CHARGE' ? 'amber' : e.type === 'PAYMENT' ? 'green' : 'gray'}`}>
                              {e.type.toLowerCase()}
                            </span>
                          </td>
                          <td>{e.note || '—'}{e.method && <span style={{ color: 'var(--ink-soft)' }}> · {e.method.replace('_', ' ').toLowerCase()}</span>}</td>
                          <td>{e.by ?? '—'}</td>
                          <td className="num">{e.type === 'CHARGE' ? '+' : '−'}{peso(e.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>
          )
        })
      )}

      {show && (
        <Modal title="New treatment plan" onClose={() => setShow(false)} busy={busy}>
          <div className="form-grid">
            {packages.length > 0 && (
              <div className="field full">
                <label>Start from package (optional)</label>
                <select value={form.templateId} onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">— blank plan —</option>
                  {packages.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} · {peso(t.defaultPrice)}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field full">
              <label>Plan name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Metal Braces Package" />
            </div>
            <div className="field">
              <label>Payment option</label>
              <select value={form.paymentType}
                onChange={(e) => setForm((f) => ({ ...f, paymentType: e.target.value }))}>
                <option value="CASH">Cash (paid in full)</option>
                <option value="INSTALLMENT">Installment (downpayment + monthly)</option>
              </select>
            </div>
            <div className="field">
              <label>Package price (₱)</label>
              <input type="number" min="0" value={form.totalPrice}
                onChange={(e) => setForm((f) => ({ ...f, totalPrice: e.target.value }))} />
            </div>
            {isInstallment && (
              <>
                <div className="field">
                  <label>Downpayment (₱)</label>
                  <input type="number" min="0" value={form.downpayment}
                    onChange={(e) => setForm((f) => ({ ...f, downpayment: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Downpayment method</label>
                  <select value={form.downpaymentMethod}
                    onChange={(e) => setForm((f) => ({ ...f, downpaymentMethod: e.target.value }))}>
                    {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Monthly due (₱)</label>
                  <input type="number" min="0" value={form.monthlyDue}
                    onChange={(e) => setForm((f) => ({ ...f, monthlyDue: e.target.value }))} />
                </div>
              </>
            )}
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

          <ProcedurePicker catalog={catalog} value={form.includedProcedures}
            onChange={(v) => setForm((f) => ({ ...f, includedProcedures: v }))} />
          <FreebieRows catalog={catalog} value={form.freebies} onChange={(v) => setForm((f) => ({ ...f, freebies: v }))} />

          <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)' }}>
            The full package price is charged to the ledger when the plan is created.
            {isInstallment
              ? ' The downpayment is recorded as the first payment right away; record each monthly payment as it comes in.'
              : ' Record the payment against this plan when the patient pays.'}
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={busy || !form.name || !form.totalPrice || planClosed} onClick={save}>
              {busy ? 'Saving…' : 'Create plan'}
            </button>
          </div>
        </Modal>
      )}

      {payFor && (
        <PlanPaymentModal
          patientId={patientId}
          plan={payFor}
          onClose={() => setPayFor(null)}
          onSaved={() => { setPayFor(null); load(); onChanged() }}
        />
      )}

      {editFor && (
        <PlanEditModal
          patientId={patientId}
          plan={editFor}
          catalog={catalog}
          onClose={() => setEditFor(null)}
          onSaved={() => { setEditFor(null); load(); onChanged() }}
        />
      )}

      {benefitAction && (
        <BenefitActionModal
          patientId={patientId}
          {...benefitAction}
          onClose={() => setBenefitAction(null)}
          onSaved={() => { setBenefitAction(null); load(); onChanged() }}
        />
      )}
    </div>
  )
}

// One benefit row inside a plan card: label, status, expandable history, and
// Void / Restore actions (OWNER only).
function FreebieRow({ plan, freebie: f, isOwner, onAct }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr>
        <td style={{ width: '40%' }}>
          <strong>{f.name}</strong>
          {f.procedureName && <span style={{ color: 'var(--ink-soft)' }}> · {f.procedureName}</span>}
        </td>
        <td>{f.label}</td>
        <td><StatusBadge value={f.status} /></td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {f.history.length > 0 && (
            <button className="btn quiet" style={{ padding: '2px 8px', fontSize: '.78rem' }}
              onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide' : `Log (${f.history.length})`}
            </button>
          )}{' '}
          {isOwner && f.remaining > 0 && (
            <button className="btn quiet" style={{ padding: '2px 8px', fontSize: '.78rem' }}
              onClick={() => onAct('void')}>Void</button>
          )}{' '}
          {isOwner && f.voided > 0 && (
            <button className="btn quiet" style={{ padding: '2px 8px', fontSize: '.78rem' }}
              onClick={() => onAct('restore')}>Restore</button>
          )}
        </td>
      </tr>
      {open && f.history.map((h) => (
        <tr key={h.id} style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
          <td>{fmtDateTime(h.createdAt)}</td>
          <td colSpan={2}>
            <span className={`badge ${h.type === 'USE' ? 'amber' : h.type === 'RESTORE' ? 'green' : 'gray'}`}>
              {h.type.toLowerCase()}
            </span>{' '}
            ×{h.qty}{h.reason ? ` — ${h.reason}` : ''}
          </td>
          <td style={{ textAlign: 'right' }}>{h.by ?? '—'}</td>
        </tr>
      ))}
    </>
  )
}

function BenefitActionModal({ patientId, plan, freebie, mode, onClose, onSaved }) {
  const max = mode === 'void' ? freebie.remaining : freebie.voided
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const n = Number(qty)
  const invalid = !n || n < 1 || n > max || !reason.trim()

  const save = async () => {
    if (!confirm(`${mode === 'void' ? 'Void' : 'Restore'} ${n} × "${freebie.name}"?`)) return
    setBusy(true)
    setError('')
    try {
      await post(`/patients/${patientId}/plans/${plan.id}/freebies/${freebie.id}/${mode}`, { qty: n, reason: reason.trim() })
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${mode === 'void' ? 'Void' : 'Restore'} benefit — ${freebie.name}`} onClose={onClose} busy={busy}>
      <p style={{ fontSize: '.88rem', color: 'var(--ink-soft)', marginTop: 0 }}>
        {mode === 'void'
          ? `${freebie.remaining} available to void. This does not affect anything already used.`
          : `${freebie.voided} voided quantity can be restored.`}
      </p>
      <div className="form-grid">
        <div className="field">
          <label>Quantity</label>
          <input type="number" min="1" max={max} value={qty} autoFocus
            onChange={(e) => setQty(e.target.value)} />
        </div>
      </div>
      <div className="field full">
        <label>Reason *</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={mode === 'void' ? 'e.g. Patient inactive 3 months' : 'e.g. Voided by mistake'} />
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
      <div className="actions">
        <button className="btn quiet" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || invalid} onClick={save}>
          {busy ? 'Saving…' : mode === 'void' ? 'Void' : 'Restore'}
        </button>
      </div>
    </Modal>
  )
}

function PlanEditModal({ patientId, plan, catalog, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: plan.name,
    paymentType: plan.paymentType,
    totalPrice: String(plan.totalPrice),
    downpayment: plan.downpayment != null ? String(plan.downpayment) : '',
    monthlyDue: plan.monthlyDue != null ? String(plan.monthlyDue) : '',
    startDate: plan.startDate ? String(plan.startDate).slice(0, 10) : '',
    notes: plan.notes || '',
    status: plan.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
  })
  const [freebies, setFreebies] = useState(
    Array.isArray(plan.freebies)
      ? plan.freebies.map((f) => ({
          ...f, procedureId: f.procedureId || '', notes: f.notes || '',
        }))
      : [],
  )
  const freebieMinQty = (f) => Math.max(1, (f.used || 0) + (f.voided || 0))
  const [procedures, setProcedures] = useState(
    Array.isArray(plan.includedProcedures) ? plan.includedProcedures.map((x) => ({ ...x })) : [],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const newPrice = Number(form.totalPrice)
  const priceDelta = newPrice - Number(plan.totalPrice)
  const isInstallment = form.paymentType === 'INSTALLMENT'

  const cancelling = form.status === 'CANCELLED' && plan.status !== 'CANCELLED'

  const save = async () => {
    if (cancelling && !confirm(`Cancel the "${plan.name}" package? Its remaining ${peso(plan.remaining)} stops counting toward Total Due. Payments already recorded stay in the ledger.`)) return
    setBusy(true)
    setError('')
    try {
      const body = {
        name: form.name,
        paymentType: form.paymentType,
        totalPrice: newPrice,
        downpayment: form.downpayment === '' ? null : Number(form.downpayment),
        monthlyDue: form.monthlyDue === '' ? null : Number(form.monthlyDue),
        startDate: form.startDate || null,
        notes: form.notes || null,
        status: form.status,
        freebies: freebies
          .filter((f) => (f.name || '').trim())
          .map((f) => ({
            ...(f.id ? { id: f.id } : {}),
            name: f.name.trim(),
            procedureId: f.procedureId || null,
            qtyIncluded: Math.max(freebieMinQty(f), Number(f.qtyIncluded) || 1),
            notes: (f.notes || '').trim() || null,
          })),
        includedProcedures: procedures
          .filter((x) => x.name.trim())
          .map((x) => ({ procedureId: x.procedureId || null, name: x.name.trim() })),
      }
      await patch(`/patients/${patientId}/plans/${plan.id}`, body)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit package — ${plan.name}`} onClose={onClose} busy={busy}>
      <div className="form-grid">
        <div className="field full">
          <label>Package name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div className="field">
          <label>Payment option</label>
          <select value={form.paymentType} onChange={(e) => setForm((f) => ({ ...f, paymentType: e.target.value }))}>
            <option value="CASH">Cash (paid in full)</option>
            <option value="INSTALLMENT">Installment (downpayment + monthly)</option>
          </select>
        </div>
        <div className="field">
          <label>Status</label>
          <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
            <option value="ACTIVE">Active</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className="field">
          <label>Total package price (₱)</label>
          <input type="number" min="0" value={form.totalPrice}
            onChange={(e) => setForm((f) => ({ ...f, totalPrice: e.target.value }))} />
        </div>
        {isInstallment && (
          <>
            <div className="field">
              <label>Downpayment (₱)</label>
              <input type="number" min="0" value={form.downpayment}
                onChange={(e) => setForm((f) => ({ ...f, downpayment: e.target.value }))} />
            </div>
            <div className="field">
              <label>Monthly adjustment / payment (₱)</label>
              <input type="number" min="0" value={form.monthlyDue}
                onChange={(e) => setForm((f) => ({ ...f, monthlyDue: e.target.value }))} />
            </div>
          </>
        )}
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

      <ProcedurePicker catalog={catalog ?? []} value={procedures} onChange={setProcedures} />
      <FreebieRows catalog={catalog ?? []} value={freebies} onChange={setFreebies} minQty={freebieMinQty} />

      {priceDelta !== 0 && Number.isFinite(priceDelta) && (
        <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)' }}>
          Changing the price writes a {priceDelta > 0 ? 'charge' : 'discount'} of {peso(Math.abs(priceDelta))} to
          the ledger so the books stay balanced. New remaining will be {peso(Math.max(0, newPrice - plan.paid))}.
        </p>
      )}
      {cancelling && (
        <p className="err" style={{ fontSize: '.85rem' }}>
          Cancelling stops this package&rsquo;s remaining {peso(plan.remaining)} from counting toward Total Due.
        </p>
      )}
      {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
      <div className="actions">
        <button className="btn quiet" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !form.name || !form.totalPrice || newPrice <= 0} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  )
}

function PlanPaymentModal({ patientId, plan, onClose, onSaved }) {
  const [form, setForm] = useState({ amount: '', method: 'CASH', note: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const amount = Number(form.amount)
  const over = amount > plan.remaining
  const invalid = !form.amount || amount <= 0 || over

  const save = async () => {
    if (!confirm(`Record a ${peso(amount)} payment toward "${plan.name}"? It can only be undone with a void on the Ledger tab.`)) return
    setBusy(true)
    setError('')
    try {
      await post(`/patients/${patientId}/plans/${plan.id}/payments`, {
        amount,
        method: form.method,
        note: form.note || null,
      })
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Record payment — ${plan.name}`} onClose={onClose} busy={busy}>
      <div className="form-grid">
        <div className="field">
          <label>Amount (₱)</label>
          <input type="number" min="0" max={plan.remaining} value={form.amount} autoFocus
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          {over && <span className="err">Cannot exceed the remaining balance</span>}
        </div>
        <div className="field">
          <label>Method</label>
          <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
            {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field full">
          <label>Note</label>
          <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="e.g. Monthly payment for June" />
        </div>
      </div>
      <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)' }}>
        Remaining balance {peso(plan.remaining)}. Paying the full remaining amount marks the package as Paid.
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
      <div className="actions">
        <button className="btn quiet" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || invalid} onClick={save}>
          {busy ? 'Saving…' : 'Record payment'}
        </button>
      </div>
    </Modal>
  )
}

/* ------------------------------ X-rays ------------------------------ */
const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'TikTok', 'Messenger', 'Twitter/X', 'Viber', 'Other']

function XrayThumb({ patientId, file, onOpen }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let objUrl
    let alive = true
    if (file.mimeType !== 'application/pdf') {
      getBlob(`/patients/${patientId}/files/${file.id}/raw`)
        .then((blob) => { if (alive) { objUrl = URL.createObjectURL(blob); setUrl(objUrl) } })
        .catch(() => {})
    }
    return () => { alive = false; if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [patientId, file.id, file.mimeType])

  return (
    <button
      onClick={() => onOpen(file)}
      style={{
        border: '1px solid var(--line)', borderRadius: 8, padding: 0, overflow: 'hidden',
        background: 'var(--bg)', width: 150, height: 150, cursor: 'pointer', display: 'grid', placeItems: 'center',
      }}
      title={file.label || file.originalName}
    >
      {file.mimeType === 'application/pdf'
        ? <span style={{ fontSize: '.8rem', color: 'var(--ink-soft)' }}>📄 PDF</span>
        : url
          ? <img src={url} alt={file.label || 'X-ray'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: '.8rem', color: 'var(--ink-soft)' }}>loading…</span>}
    </button>
  )
}

const XRAY_TYPES = ['Panoramic', 'Periapical', 'Bitewing', 'Cephalometric', 'CBCT', 'Intraoral photo', 'Other']
const blankXrayMeta = () => ({ label: '', xrayType: '', takenAt: '', description: '', notes: '' })

function XraysTab({ patientId }) {
  const { user } = useAuth()
  const canDelete = user?.role === 'OWNER' || user?.role === 'DENTIST'
  const [files, setFiles] = useState([])
  const [meta, setMeta] = useState(blankXrayMeta())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState(null)
  const [viewUrl, setViewUrl] = useState(null)
  const [removingId, setRemovingId] = useState(null)
  const [edit, setEdit] = useState(null) // metadata being edited for `viewing`
  const inputRef = useRef(null)

  const load = () => get(`/patients/${patientId}/files`).then(setFiles).catch(() => {})
  useEffect(() => { load() }, [patientId])

  useEffect(() => {
    if (!viewing) { setViewUrl(null); return }
    let objUrl
    getBlob(`/patients/${patientId}/files/${viewing.id}/raw`)
      .then((blob) => { objUrl = URL.createObjectURL(blob); setViewUrl(objUrl) })
      .catch(() => {})
    return () => { if (objUrl) URL.revokeObjectURL(objUrl) }
  }, [viewing, patientId])

  const upload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      for (const [k, v] of Object.entries(meta)) if (v && String(v).trim()) fd.append(k, String(v).trim())
      await postForm(`/patients/${patientId}/files`, fd)
      setMeta(blankXrayMeta())
      if (inputRef.current) inputRef.current.value = ''
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (file) => {
    if (!confirm(`Delete "${file.label || file.originalName}"? This permanently removes the image.`)) return
    setRemovingId(file.id)
    setError('')
    try {
      await del(`/patients/${patientId}/files/${file.id}`)
      setViewing(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRemovingId(null)
    }
  }

  const saveMeta = async () => {
    setBusy(true); setError('')
    try {
      await patch(`/patients/${patientId}/files/${viewing.id}`, {
        label: edit.label || null,
        xrayType: edit.xrayType || null,
        takenAt: edit.takenAt || null,
        description: edit.description || null,
        notes: edit.notes || null,
      })
      setEdit(null)
      const fresh = await get(`/patients/${patientId}/files`)
      setFiles(fresh)
      setViewing(fresh.find((f) => f.id === viewing.id) || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 10 }}>
        <h2>X-rays &amp; images</h2>
      </div>

      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Type</label>
          <select value={meta.xrayType} onChange={(e) => setMeta((m) => ({ ...m, xrayType: e.target.value }))}>
            <option value="">—</option>
            {XRAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Date taken</label>
          <input type="date" max={today()} value={meta.takenAt}
            onChange={(e) => setMeta((m) => ({ ...m, takenAt: e.target.value }))} />
        </div>
        <div className="field">
          <label>Label</label>
          <input value={meta.label} onChange={(e) => setMeta((m) => ({ ...m, label: e.target.value }))}
            placeholder="short name" />
        </div>
        <div className="field full">
          <label>Description</label>
          <input value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
            placeholder="e.g. Full mouth, pre-ortho" />
        </div>
        <div className="field full">
          <label>Notes</label>
          <input value={meta.notes} onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <button className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Uploading…' : 'Upload file'}
        </button>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf"
          hidden onChange={upload} />
        <span style={{ fontSize: '.82rem', color: 'var(--ink-soft)' }}>
          PNG, JPEG, WebP or PDF · up to 15 MB · new files are added, never replace older ones.
        </span>
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}

      {files.length === 0 ? (
        <div className="empty">No X-rays or images uploaded yet.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
          {files.map((f) => (
            <div key={f.id} style={{ width: 150 }}>
              <XrayThumb patientId={patientId} file={f} onOpen={(x) => { setViewing(x); setEdit(null) }} />
              <div style={{ fontSize: '.8rem', marginTop: 4, wordBreak: 'break-word', fontWeight: 600 }}>
                {f.xrayType || f.label || f.originalName}
              </div>
              <div style={{ fontSize: '.75rem', color: 'var(--ink-soft)' }}>
                {f.takenAt ? `taken ${fmtDate(f.takenAt)}` : `added ${fmtDate(f.createdAt)}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <Modal title={viewing.label || viewing.xrayType || viewing.originalName} onClose={() => setViewing(null)} busy={busy}>
          {viewUrl
            ? viewing.mimeType === 'application/pdf'
              ? <iframe title="X-ray PDF" src={viewUrl} style={{ width: '100%', height: '60vh', border: 'none' }} />
              : <img src={viewUrl} alt={viewing.label || 'X-ray'} style={{ width: '100%', borderRadius: 8 }} />
            : <div className="empty">Loading…</div>}

          {edit ? (
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Type</label>
                <select value={edit.xrayType} onChange={(e) => setEdit((m) => ({ ...m, xrayType: e.target.value }))}>
                  <option value="">—</option>
                  {XRAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Date taken</label>
                <input type="date" max={today()} value={edit.takenAt}
                  onChange={(e) => setEdit((m) => ({ ...m, takenAt: e.target.value }))} />
              </div>
              <div className="field full">
                <label>Label</label>
                <input value={edit.label} onChange={(e) => setEdit((m) => ({ ...m, label: e.target.value }))} />
              </div>
              <div className="field full">
                <label>Description</label>
                <input value={edit.description} onChange={(e) => setEdit((m) => ({ ...m, description: e.target.value }))} />
              </div>
              <div className="field full">
                <label>Notes</label>
                <input value={edit.notes} onChange={(e) => setEdit((m) => ({ ...m, notes: e.target.value }))} />
              </div>
            </div>
          ) : (
            <table className="data" style={{ marginTop: 12 }}>
              <tbody>
                <tr><th style={{ width: 130 }}>Type</th><td>{viewing.xrayType || '—'}</td></tr>
                <tr><th>Date taken</th><td>{viewing.takenAt ? fmtDate(viewing.takenAt) : '—'}</td></tr>
                <tr><th>Description</th><td>{viewing.description || '—'}</td></tr>
                <tr><th>Notes</th><td>{viewing.notes || '—'}</td></tr>
                <tr><th>Uploaded</th><td>{fmtDateTime(viewing.createdAt)} · {viewing.originalName}</td></tr>
              </tbody>
            </table>
          )}

          <div className="actions">
            {canDelete && !edit && (
              <button className="btn danger" style={{ marginRight: 'auto' }}
                disabled={removingId === viewing.id} onClick={() => remove(viewing)}>
                {removingId === viewing.id ? 'Deleting…' : 'Delete'}
              </button>
            )}
            {edit ? (
              <>
                <button className="btn quiet" onClick={() => setEdit(null)}>Cancel</button>
                <button className="btn" disabled={busy} onClick={saveMeta}>{busy ? 'Saving…' : 'Save details'}</button>
              </>
            ) : (
              <>
                <button className="btn quiet" onClick={() => setEdit({
                  label: viewing.label || '', xrayType: viewing.xrayType || '',
                  takenAt: viewing.takenAt ? String(viewing.takenAt).slice(0, 10) : '',
                  description: viewing.description || '', notes: viewing.notes || '',
                })}>Edit details</button>
                <button className="btn quiet" onClick={() => setViewing(null)}>Close</button>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ------------------------------ Info ------------------------------ */
function InfoTab({ patient, onChanged }) {
  const [edit, setEdit] = useState(false)
  const row = (label, value) => (
    <tr><th style={{ width: 180 }}>{label}</th><td>{value || '—'}</td></tr>
  )
  const socials = Array.isArray(patient.socialMedia) ? patient.socialMedia : []
  return (
    <div className="card">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2>Patient information</h2>
        <button className="btn quiet" onClick={() => setEdit(true)}>Edit</button>
      </div>
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
          {row(
            'Social media',
            socials.length > 0
              ? socials.map((s, i) => <div key={i}>{s.platform}: {s.handle}</div>)
              : null,
          )}
          {row('Consent recorded', patient.consentSignedAt ? fmtDateTime(patient.consentSignedAt) : 'Not recorded')}
          {row('Registered', fmtDateTime(patient.createdAt))}
        </tbody>
      </table>

      {edit && (
        <PatientEditModal patient={patient} onClose={() => setEdit(false)}
          onSaved={() => { setEdit(false); onChanged() }} />
      )}
    </div>
  )
}

function PatientEditModal({ patient, onClose, onSaved }) {
  const [form, setForm] = useState({
    firstName: patient.firstName || '', lastName: patient.lastName || '', middleName: patient.middleName || '',
    birthDate: patient.birthDate ? String(patient.birthDate).slice(0, 10) : '', sex: patient.sex || '',
    phone: patient.phone || '', email: patient.email || '', address: patient.address || '',
    guardianName: patient.guardianName || '', guardianPhone: patient.guardianPhone || '',
    allergies: patient.allergies || '', medicalNotes: patient.medicalNotes || '',
  })
  const [socials, setSocials] = useState(
    Array.isArray(patient.socialMedia) ? patient.socialMedia.map((s) => ({ ...s })) : [],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const setS = (i, k, v) => setSocials((l) => l.map((s, idx) => (idx === i ? { ...s, [k]: v } : s)))
  const addS = () => setSocials((l) => [...l, { platform: 'Facebook', handle: '' }])
  const removeS = (i) => setSocials((l) => l.filter((_, idx) => idx !== i))

  const keyChanged =
    form.firstName.trim() !== (patient.firstName || '') ||
    form.lastName.trim() !== (patient.lastName || '') ||
    form.birthDate !== (patient.birthDate ? String(patient.birthDate).slice(0, 10) : '') ||
    form.phone.trim() !== (patient.phone || '')

  const save = async () => {
    if (keyChanged && !confirm('You changed the patient’s name, birth date or phone. Save these identity changes?')) return
    setBusy(true)
    setError('')
    try {
      const body = {
        ...form,
        middleName: form.middleName || null,
        birthDate: form.birthDate || null,
        sex: form.sex || null,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        guardianName: form.guardianName || null,
        guardianPhone: form.guardianPhone || null,
        allergies: form.allergies || null,
        medicalNotes: form.medicalNotes || null,
        socialMedia: socials
          .filter((s) => s.platform && s.handle.trim())
          .map((s) => ({ platform: s.platform, handle: s.handle.trim() })),
      }
      await patch(`/patients/${patient.id}`, body)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Edit patient" onClose={onClose} busy={busy}>
      <div className="form-grid">
        <div className="field"><label>First name *</label><input value={form.firstName} onChange={set('firstName')} /></div>
        <div className="field"><label>Last name *</label><input value={form.lastName} onChange={set('lastName')} /></div>
        <div className="field"><label>Middle name</label><input value={form.middleName} onChange={set('middleName')} /></div>
        <div className="field"><label>Birth date</label><input type="date" max={today()} value={form.birthDate} onChange={set('birthDate')} /></div>
        <div className="field">
          <label>Sex</label>
          <select value={form.sex} onChange={set('sex')}>
            <option value="">—</option><option value="F">Female</option><option value="M">Male</option>
          </select>
        </div>
        <div className="field"><label>Phone</label><input value={form.phone} onChange={set('phone')} /></div>
        <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
        <div className="field full"><label>Address</label><input value={form.address} onChange={set('address')} /></div>
        <div className="field"><label>Guardian name</label><input value={form.guardianName} onChange={set('guardianName')} /></div>
        <div className="field"><label>Guardian phone</label><input value={form.guardianPhone} onChange={set('guardianPhone')} /></div>
        <div className="field full"><label>Allergies</label><input value={form.allergies} onChange={set('allergies')} /></div>
        <div className="field full"><label>Medical notes</label><textarea rows={2} value={form.medicalNotes} onChange={set('medicalNotes')} /></div>
      </div>

      <div className="field">
        <label>Social media</label>
        {socials.map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 8, marginBottom: 6 }}>
            <select value={s.platform} onChange={(e) => setS(i, 'platform', e.target.value)}
              style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }}>
              {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input placeholder="handle or link" value={s.handle}
              onChange={(e) => setS(i, 'handle', e.target.value)}
              style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }} />
            <button className="btn quiet" onClick={() => removeS(i)} title="Remove">✕</button>
          </div>
        ))}
        <button className="btn ghost" onClick={addS} style={{ marginTop: 4 }}>+ Add account</button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
      <div className="actions">
        <button className="btn quiet" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !form.firstName || !form.lastName} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  )
}
