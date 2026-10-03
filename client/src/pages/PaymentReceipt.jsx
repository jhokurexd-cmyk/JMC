import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { get } from '../lib/api'
import { peso, fmtDate, fmtDateTime, fullName } from '../lib/format'

// Printable single-payment receipt. Opens in its own tab; Ctrl/Cmd-P to print.
export default function PaymentReceipt() {
  const { id, entryId } = useParams()
  const [patient, setPatient] = useState(null)
  const [ledger, setLedger] = useState(null)

  useEffect(() => {
    get(`/patients/${id}`).then(setPatient).catch(() => {})
    get(`/patients/${id}/ledger`).then(setLedger).catch(() => {})
  }, [id])

  if (!patient || !ledger) return <div style={{ padding: 40 }}>Loading…</div>

  const p = ledger.entries.find((e) => e.id === entryId)
  if (!p) return <div style={{ padding: 40 }}>Receipt not found.</div>

  const forLabel =
    p.plan?.name ||
    (p.appliesTo?.note ? `Charge — ${p.appliesTo.note}` : null) ||
    (p.visitProcedure?.procedure?.name
      ? `Visit ${p.visitProcedure.visit?.visitDate ? fmtDate(p.visitProcedure.visit.visitDate) : ''} — ${p.visitProcedure.procedure.name}`
      : null) ||
    'General payment'
  const method = (p.method || 'other').replace('_', ' ').toLowerCase()
  const status = p.paymentStatus || 'PAID'

  return (
    <div className="receipt">
      <style>{`
        .receipt { max-width: 460px; margin: 0 auto; padding: 32px 28px; color: #16211e;
          font: 13px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
        .receipt h1 { margin: 0; font-size: 1.15rem; letter-spacing: .02em; }
        .receipt .sub { color: #5c6b66; font-size: .82rem; }
        .receipt .no { margin: 14px 0 2px; font-size: 1.35rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .receipt hr { border: none; border-top: 1px dashed #b9c4bf; margin: 14px 0; }
        .receipt .row { display: flex; justify-content: space-between; gap: 12px; margin: 3px 0; }
        .receipt .row .k { color: #5c6b66; }
        .receipt .row .v { text-align: right; font-variant-numeric: tabular-nums; }
        .receipt .amount { font-size: 1.5rem; font-weight: 800; }
        .receipt .flag { margin: 10px 0; padding: 6px 10px; border: 2px solid #b3261e; color: #b3261e;
          font-weight: 700; text-align: center; letter-spacing: .08em; border-radius: 6px; }
        .receipt .toolbar { margin-bottom: 18px; }
        @media print { .receipt .toolbar { display: none; } .receipt { padding: 0; } }
      `}</style>

      <div className="toolbar">
        <button className="btn" onClick={() => window.print()}>Print</button>
      </div>

      <h1>Official Receipt</h1>
      <div className="sub">Dental clinic — payment acknowledgement</div>

      {status !== 'PAID' && <div className="flag">{status}</div>}

      <div className="no">{p.receiptNo || '—'}</div>
      <div className="sub">{fmtDateTime(p.createdAt)}</div>

      <hr />
      <div className="row"><span className="k">Received from</span><span className="v">{fullName(patient)}</span></div>
      <div className="row"><span className="k">For</span><span className="v">{forLabel}</span></div>
      {p.note && <div className="row"><span className="k">Note</span><span className="v">{p.note}</span></div>}
      <div className="row"><span className="k">Payment method</span><span className="v">{method}</span></div>
      <div className="row"><span className="k">Received by</span><span className="v">{p.author?.name || '—'}</span></div>

      <hr />
      <div className="row"><span className="k">Previous balance</span><span className="v">{p.balanceBefore != null ? peso(p.balanceBefore) : '—'}</span></div>
      <div className="row"><span className="k amount">Amount paid</span><span className="v amount">{peso(p.amount)}</span></div>
      <div className="row"><span className="k">Remaining balance</span><span className="v">{p.balanceAfter != null ? peso(p.balanceAfter) : '—'}</span></div>

      <hr />
      <div className="sub">
        This receipt is a computer-generated record. Void or refund entries keep the original on file.
      </div>
    </div>
  )
}
