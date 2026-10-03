import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { get } from '../lib/api'
import { peso, fmtDate, fmtDateTime, fullName } from '../lib/format'

// PATIENT ACCOUNT / PAYMENT STATEMENT — for clinic staff.
//   1. Account Summary        — the 3 numbers, at a glance
//   2. Treatment Balance      — charge / paid / remaining per treatment
//   3. Detailed history       — every transaction, with a running balance;
//                               voided + reversed rows are shown but flagged
//                               and do NOT move the running balance.
// Underlying records are never changed. The admin Ledger/Payments tabs are the
// live working screens; this is the printable account statement.
const num = (n) => Number(n || 0)

// A clean, human name for a ledger charge.
function chargeName(e) {
  if (e.visitProcedure?.procedure?.name) {
    const q = e.visitProcedure.quantity
    return e.visitProcedure.procedure.name + (q > 1 ? ` ×${q}` : '')
  }
  return (e.note || 'Treatment').split(' · ')[0].replace(/\s*\(tooth[^)]*\)/i, '').trim()
}

export default function PatientStatement() {
  const { id } = useParams()
  const [patient, setPatient] = useState(null)
  const [ledger, setLedger] = useState(null)
  const [plans, setPlans] = useState(null)
  const [visits, setVisits] = useState([])

  useEffect(() => {
    get(`/patients/${id}`).then(setPatient).catch(() => {})
    get(`/patients/${id}/ledger`).then(setLedger).catch(() => {})
    get(`/patients/${id}/plans`).then(setPlans).catch(() => setPlans([]))
    get(`/patients/${id}/visits`).then(setVisits).catch(() => {})
  }, [id])

  if (!patient || !ledger || !plans) return <div style={{ padding: 40 }}>Loading…</div>

  const entries = ledger.entries
  const valid = (e) => !e.voided && !e.isReversal
  const chargeById = new Map(entries.filter((e) => e.type === 'CHARGE').map((e) => [e.id, e]))
  const isPlanLinked = (e) =>
    e.planId != null || (e.appliesToId != null && chargeById.get(e.appliesToId)?.planId != null)
  const activePlans = plans.filter((p) => p.status !== 'CANCELLED')

  /* -------------------- Treatment Balance Summary -------------------- */
  const planRows = activePlans.map((p) => ({
    key: p.id,
    name: `${p.name}${p.paymentType === 'INSTALLMENT' ? ' (installment)' : ''}`,
    charge: num(p.totalPrice),
    paid: num(p.paid),
    discount: 0,
    remaining: num(p.remaining),
  }))

  // non-package charges, grouped by treatment name; each charge's payments +
  // discounts (appliesTo it) are its "paid"
  const npGroups = new Map()
  for (const c of entries.filter((e) => e.type === 'CHARGE' && !e.planId && valid(e))) {
    const name = chargeName(c)
    const g = npGroups.get(name) || { key: name, name, charge: 0, paid: 0, discount: 0, remaining: 0 }
    const pay = entries.filter((e) => e.type === 'PAYMENT' && e.appliesToId === c.id && valid(e)).reduce((s, e) => s + num(e.amount), 0)
    const disc = entries.filter((e) => e.type === 'DISCOUNT' && e.appliesToId === c.id && valid(e)).reduce((s, e) => s + num(e.amount), 0)
    g.charge += num(c.amount)
    g.paid += pay + disc
    g.discount += disc
    g.remaining += num(c.remaining) // enrichEntries: amount − (payments + discounts) against it
    npGroups.set(name, g)
  }
  const chargeRows = [...npGroups.values()]

  // payments / discounts NOT tied to a plan or a specific charge
  const unallocatedPay = entries
    .filter((e) => e.type === 'PAYMENT' && !e.planId && !e.appliesToId && valid(e))
    .reduce((s, e) => s + num(e.amount), 0)
  const generalDisc = entries
    .filter((e) => e.type === 'DISCOUNT' && !e.planId && !e.appliesToId && valid(e))
    .reduce((s, e) => s + num(e.amount), 0)

  const summaryRows = [...planRows, ...chargeRows]
  const totalCharges = summaryRows.reduce((s, r) => s + r.charge, 0)
  const totalDiscount = summaryRows.reduce((s, r) => s + r.discount, 0) + generalDisc
  const totalValidPayments =
    summaryRows.reduce((s, r) => s + r.paid, 0) + unallocatedPay + generalDisc
  const currentBalance = num(ledger.balance) // system Total Due — authoritative

  /* -------------------- Detailed transaction history -------------------- */
  // Inject one synthetic "package total" charge per active plan so the running
  // balance is meaningful. Plan-linked adjustment CHARGES are shown but do not
  // move the running balance (they are covered by that package total).
  const synthetic = activePlans.map((p) => ({
    id: `plan-${p.id}`,
    synthetic: true,
    createdAt: p.startDate || p.createdAt,
    type: 'CHARGE',
    amount: num(p.totalPrice),
    method: null,
    _desc: `${p.name} — package total`,
    planId: p.id,
  }))
  const detail = [...entries, ...synthetic]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  let running = 0
  const detailRows = detail.map((e) => {
    const dead = e.voided || e.isReversal
    const adjustmentCharge = !e.synthetic && e.type === 'CHARGE' && e.planId != null
    let moved = true
    if (dead || adjustmentCharge) {
      moved = false
    } else if (e.type === 'CHARGE') {
      running += num(e.amount)
    } else {
      running -= num(e.amount) // PAYMENT or DISCOUNT reduces what's owed
    }
    let desc = e._desc
    if (!desc) {
      if (e.type === 'CHARGE') desc = chargeName(e) + (adjustmentCharge ? ' — within package' : '')
      else {
        const tgt = e.appliesToId ? chargeById.get(e.appliesToId) : null
        desc = (e.note || (e.type === 'PAYMENT' ? 'Payment' : 'Discount'))
        if (e.plan?.name) desc += ` — ${e.plan.name}`
        else if (tgt) desc += ` — ${chargeName(tgt)}`
        else if (e.type === 'PAYMENT') desc += ' (unallocated)'
      }
    }
    const tag = e.voided
      ? 'VOIDED'
      : e.isReversal
        ? (e.reversalKind === 'REFUND' ? 'REFUND / REVERSAL' : 'VOID REVERSAL')
        : null
    return {
      id: e.id,
      date: e.createdAt,
      type: e.type[0] + e.type.slice(1).toLowerCase(),
      desc,
      method: e.method ? e.method.replace('_', ' ').toLowerCase() : '—',
      amount: num(e.amount),
      running: moved ? running : null,
      dead,
      tag,
      adjustmentCharge,
    }
  })

  return (
    <div className="statement">
      <style>{`
        .statement { max-width: 820px; margin: 0 auto; padding: 34px 30px; color: #16211e;
          font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .statement h1 { margin: 0; font-size: 1.25rem; letter-spacing: .05em; }
        .statement h2 { margin: 24px 0 6px; font-size: .9rem; text-transform: uppercase; letter-spacing: .07em;
          color: #3f4f4a; border-bottom: 1.5px solid #16211e; padding-bottom: 4px; }
        .statement .id-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 16px; margin-top: 10px; font-size: .88rem; }
        .statement .id-grid .k { color: #5c6b66; }
        .statement .summary { margin-top: 12px; border: 1.5px solid #16211e; border-radius: 8px; max-width: 420px; overflow: hidden; }
        .statement .summary .row { display: flex; justify-content: space-between; padding: 8px 16px; font-size: .95rem; }
        .statement .summary .row + .row { border-top: 1px solid #dfe6e3; }
        .statement .summary .row.big { background: #16211e; color: #fff; font-size: 1.15rem; font-weight: 800; }
        .statement .summary .v { font-variant-numeric: tabular-nums; }
        .statement .summary .sub { color: #5c6b66; font-size: .8rem; padding: 2px 16px 6px; }
        .statement table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        .statement th, .statement td { padding: 6px 8px; border-bottom: 1px solid #e4e9e6; vertical-align: top; text-align: left; }
        .statement th { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #5c6b66; }
        .statement td.num, .statement th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .statement tr.total td { border-top: 2px solid #16211e; border-bottom: none; font-weight: 800; }
        .statement tr.dead td { color: #9aa4a0; text-decoration: line-through; }
        .statement tr.dead td .tag { text-decoration: none; }
        .statement tr.covered td { color: #5c6b66; }
        .statement .tag { display: inline-block; font-size: .66rem; font-weight: 800; letter-spacing: .04em;
          padding: 1px 6px; border-radius: 4px; border: 1px solid #b3261e; color: #b3261e; margin-left: 6px; }
        .statement .pill { display: inline-block; font-size: .7rem; font-weight: 700; padding: 1px 7px; border-radius: 99px;
          background: #e3f1e6; color: #1f6b2e; }
        .statement .muted { color: #5c6b66; }
        .statement .note { margin-top: 18px; font-size: .8rem; color: #5c6b66; }
        .statement .toolbar { margin-bottom: 18px; }
        @media print { .statement .toolbar { display: none; } .statement { padding: 0; max-width: none; } }
      `}</style>

      <div className="toolbar"><button className="btn" onClick={() => window.print()}>Print</button></div>

      <h1>PATIENT ACCOUNT / PAYMENT STATEMENT</h1>

      <h2>Patient Information</h2>
      <div className="id-grid">
        <span className="k">Patient name</span><span>{fullName(patient)}</span>
        <span className="k">Patient ID</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{patient.id}</span>
        <span className="k">Contact</span><span>{patient.phone || '—'}</span>
        <span className="k">Statement date</span><span>{fmtDateTime(new Date())}</span>
      </div>

      <h2>Account Summary</h2>
      <div className="summary">
        <div className="row"><span>Total Charges</span><span className="v">{peso(totalCharges)}</span></div>
        <div className="row"><span>Total Valid Payments</span><span className="v">{peso(totalValidPayments)}</span></div>
        {totalDiscount > 0 && <div className="sub">includes {peso(totalDiscount)} in discounts / adjustments</div>}
        <div className="row big">
          <span>{currentBalance > 0 ? 'CURRENT BALANCE' : 'BALANCE'}</span>
          <span className="v">{peso(Math.max(0, currentBalance))}</span>
        </div>
      </div>
      {currentBalance < 0 && (
        <p className="note">Account is in credit by {peso(-currentBalance)} — applied to future treatment.</p>
      )}

      <h2>Treatment Balance Summary</h2>
      <table>
        <thead>
          <tr>
            <th>Treatment / Service</th>
            <th className="num">Total Charge</th>
            <th className="num">Total Paid</th>
            <th className="num">Remaining Balance</th>
          </tr>
        </thead>
        <tbody>
          {summaryRows.map((r) => (
            <tr key={r.key}>
              <td>
                {r.name}
                {r.discount > 0 && <span className="muted"> (incl. {peso(r.discount)} discount)</span>}
              </td>
              <td className="num">{peso(r.charge)}</td>
              <td className="num">{peso(r.paid)}</td>
              <td className="num">{r.remaining > 0 ? peso(r.remaining) : <span className="pill">Paid</span>}</td>
            </tr>
          ))}
          {unallocatedPay > 0 && (
            <tr>
              <td>Unallocated payment <span className="muted">(not tied to a specific treatment)</span></td>
              <td className="num">—</td>
              <td className="num">{peso(unallocatedPay)}</td>
              <td className="num">—</td>
            </tr>
          )}
          {generalDisc > 0 && (
            <tr>
              <td>Account discount / adjustment</td>
              <td className="num">—</td>
              <td className="num">{peso(generalDisc)}</td>
              <td className="num">—</td>
            </tr>
          )}
          <tr className="total">
            <td>TOTAL</td>
            <td className="num">{peso(totalCharges)}</td>
            <td className="num">{peso(totalValidPayments)}</td>
            <td className="num">{peso(Math.max(0, currentBalance))}</td>
          </tr>
        </tbody>
      </table>
      <p className="note" style={{ marginTop: 6 }}>
        Braces monthly adjustments are covered by the package price — they are listed in the history
        below but are not separate charges. Voided and reversed payments are excluded from Total Valid
        Payments.
      </p>

      <h2>Detailed Transaction History</h2>
      {detailRows.length === 0 ? (
        <p className="muted">No transactions recorded.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ width: 92 }}>Date</th>
              <th style={{ width: 74 }}>Type</th>
              <th>Description</th>
              <th style={{ width: 78 }}>Method</th>
              <th className="num">Amount</th>
              <th className="num">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            {detailRows.map((r) => (
              <tr key={r.id} className={r.dead ? 'dead' : r.adjustmentCharge ? 'covered' : undefined}>
                <td>{fmtDate(r.date)}</td>
                <td>{r.type}</td>
                <td>
                  {r.desc}
                  {r.tag && <span className="tag">{r.tag}</span>}
                  {r.adjustmentCharge && !r.tag && <span className="muted"> · covered by package</span>}
                </td>
                <td>{r.method}</td>
                <td className="num">{peso(r.amount)}</td>
                <td className="num">{r.running == null ? '—' : peso(r.running)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="note">
        Running Balance = valid charges to date minus valid payments to date. Rows marked
        <span className="tag" style={{ margin: '0 4px' }}>VOIDED</span> or
        <span className="tag" style={{ margin: '0 4px' }}>REVERSAL</span> are kept for audit but do not
        affect the balance. Underlying records are unchanged. Generated {fmtDateTime(new Date())}.
      </p>
    </div>
  )
}
