import { useEffect, useState } from 'react'
import { get, post, patch, del } from '../lib/api'
import { peso } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import FreebieRows, { normalizeFreebie } from '../components/FreebieRows'
import ProcedurePicker from '../components/ProcedurePicker'

export default function Procedures() {
  const [tab, setTab] = useState('procedures')
  return (
    <>
      <div className="page-head"><h1>Procedures &amp; packages</h1></div>
      <div className="tabs">
        {[['procedures', 'Procedures'], ['packages', 'Packages']].map(([t, label]) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      {tab === 'procedures' ? <ProceduresCatalog /> : <PackagesCatalog />}
    </>
  )
}

/* --------------------------- Procedures --------------------------- */
function ProceduresCatalog() {
  const { user } = useAuth()
  const canEdit = user?.role === 'OWNER' || user?.role === 'DENTIST'
  const [procedures, setProcedures] = useState([])
  const [modal, setModal] = useState(null) // { id?, name, category, defaultPrice }
  const [busy, setBusy] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const [error, setError] = useState('')

  const load = () => get('/procedures').then(setProcedures).catch(() => {})
  useEffect(() => { load() }, [])

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        name: modal.name,
        category: modal.category || null,
        defaultPrice: Number(modal.defaultPrice),
        allowQuantity: !!modal.allowQuantity,
      }
      if (modal.id) await patch(`/procedures/${modal.id}`, body)
      else await post('/procedures', body)
      setModal(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p) => {
    if (!confirm(`Remove "${p.name}" from the catalog? Past visits keep their records.`)) return
    setRemovingId(p.id)
    setError('')
    try {
      await del(`/procedures/${p.id}`)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <>
      {canEdit && (
        <div className="page-head" style={{ marginBottom: 12 }}>
          <span />
          <button className="btn" onClick={() => setModal({ name: '', category: '', defaultPrice: '', allowQuantity: false })}>
            Add procedure
          </button>
        </div>
      )}
      <div className="card">
        {procedures.length === 0 ? (
          <div className="empty">No procedures yet. Run the seed script or add them here.</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Procedure</th><th>Category</th><th className="num">Default price</th><th>Qty</th>{canEdit && <th></th>}</tr>
            </thead>
            <tbody>
              {procedures.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.category || '—'}</td>
                  <td className="num">{peso(p.defaultPrice)}</td>
                  <td>{p.allowQuantity ? <span className="badge teal">multi</span> : '—'}</td>
                  {canEdit && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn quiet" onClick={() => setModal({ ...p })}>Edit</button>{' '}
                      <button className="btn quiet" disabled={removingId === p.id} onClick={() => remove(p)}>
                        {removingId === p.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <Modal title={modal.id ? 'Edit procedure' : 'Add procedure'} onClose={() => setModal(null)} busy={busy}>
          <div className="field">
            <label>Name</label>
            <input value={modal.name} onChange={(e) => setModal((m) => ({ ...m, name: e.target.value }))} />
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Category</label>
              <input value={modal.category ?? ''} onChange={(e) => setModal((m) => ({ ...m, category: e.target.value }))}
                placeholder="e.g. Orthodontics" />
            </div>
            <div className="field">
              <label>Default price (₱)</label>
              <input type="number" min="0" value={modal.defaultPrice}
                onChange={(e) => setModal((m) => ({ ...m, defaultPrice: e.target.value }))} />
            </div>
          </div>
          <label className="check" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={!!modal.allowQuantity}
              onChange={(e) => setModal((m) => ({ ...m, allowQuantity: e.target.checked }))} />
            <span>Allow quantity / multiple items — record N of this procedure with a per-item price on a visit</span>
          </label>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn" disabled={busy || !modal.name || modal.defaultPrice === ''} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ---------------------------- Packages --------------------------- */
const blankPackage = () => ({
  name: '', paymentType: 'INSTALLMENT', defaultPrice: '', downpayment: '', monthlyDue: '', notes: '',
  freebies: [], procedures: [],
})

function PackagesCatalog() {
  const { user } = useAuth()
  const canEdit = user?.role === 'OWNER' || user?.role === 'DENTIST'
  const [packages, setPackages] = useState([])
  const [catalog, setCatalog] = useState([])
  const [modal, setModal] = useState(null)
  const [busy, setBusy] = useState(false)
  const [removingId, setRemovingId] = useState(null)
  const [error, setError] = useState('')

  const load = () => get('/packages').then(setPackages).catch(() => {})
  useEffect(() => { load(); get('/procedures').then(setCatalog).catch(() => {}) }, [])

  const openNew = () => { setModal(blankPackage()); setError('') }
  const openEdit = (p) => {
    setError('')
    setModal({
      id: p.id,
      name: p.name,
      paymentType: p.paymentType,
      defaultPrice: String(p.defaultPrice),
      downpayment: p.downpayment != null ? String(p.downpayment) : '',
      monthlyDue: p.monthlyDue != null ? String(p.monthlyDue) : '',
      notes: p.notes || '',
      freebies: (Array.isArray(p.freebies) ? p.freebies : []).map(normalizeFreebie),
      procedures: p.procedures.map((x) => ({ procedureId: x.procedureId, name: x.name })),
    })
  }

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        name: modal.name,
        paymentType: modal.paymentType,
        defaultPrice: Number(modal.defaultPrice),
        downpayment: modal.downpayment === '' ? null : Number(modal.downpayment),
        monthlyDue: modal.monthlyDue === '' ? null : Number(modal.monthlyDue),
        notes: modal.notes || null,
        freebies: modal.freebies
          .filter((f) => (f.name || '').trim())
          .map((f) => ({
            name: f.name.trim(),
            procedureId: f.procedureId || null,
            qtyIncluded: Math.max(1, Number(f.qtyIncluded) || 1),
            notes: (f.notes || '').trim() || null,
          })),
        procedureIds: modal.procedures.map((x) => x.procedureId).filter(Boolean),
      }
      if (modal.id) await patch(`/packages/${modal.id}`, body)
      else await post('/packages', body)
      setModal(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p) => {
    if (!confirm(`Remove the "${p.name}" package? Plans already created from it keep their details.`)) return
    setRemovingId(p.id)
    setError('')
    try {
      await del(`/packages/${p.id}`)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <>
      {canEdit && (
        <div className="page-head" style={{ marginBottom: 12 }}>
          <span />
          <button className="btn" onClick={openNew}>Add package</button>
        </div>
      )}
      <div className="card">
        {packages.length === 0 ? (
          <div className="empty">
            No packages yet. {canEdit ? 'Create one to reuse when starting a patient’s plan.' : ''}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Package</th><th>Payment</th><th className="num">Default price</th>
                <th className="num">Procedures</th><th className="num">Freebies</th>{canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    {p.procedures.length > 0 && (
                      <div style={{ fontSize: '.8rem', color: 'var(--ink-soft)' }}>
                        {p.procedures.map((x) => x.name).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td>{p.paymentType === 'INSTALLMENT' ? 'Installment' : 'Cash'}</td>
                  <td className="num">{peso(p.defaultPrice)}</td>
                  <td className="num">{p.procedures.length}</td>
                  <td className="num">{Array.isArray(p.freebies) ? p.freebies.length : 0}</td>
                  {canEdit && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn quiet" onClick={() => openEdit(p)}>Edit</button>{' '}
                      <button className="btn quiet" disabled={removingId === p.id} onClick={() => remove(p)}>
                        {removingId === p.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <Modal title={modal.id ? 'Edit package' : 'Add package'} onClose={() => setModal(null)} busy={busy}>
          <div className="form-grid">
            <div className="field full">
              <label>Package name</label>
              <input value={modal.name} onChange={(e) => setModal((m) => ({ ...m, name: e.target.value }))}
                placeholder="e.g. Metal Braces Package" />
            </div>
            <div className="field">
              <label>Payment option</label>
              <select value={modal.paymentType} onChange={(e) => setModal((m) => ({ ...m, paymentType: e.target.value }))}>
                <option value="INSTALLMENT">Installment (downpayment + monthly)</option>
                <option value="CASH">Cash (paid in full)</option>
              </select>
            </div>
            <div className="field">
              <label>Default price (₱)</label>
              <input type="number" min="0" value={modal.defaultPrice}
                onChange={(e) => setModal((m) => ({ ...m, defaultPrice: e.target.value }))} />
            </div>
            <div className="field">
              <label>Default downpayment (₱)</label>
              <input type="number" min="0" value={modal.downpayment}
                onChange={(e) => setModal((m) => ({ ...m, downpayment: e.target.value }))} />
            </div>
            <div className="field">
              <label>Default monthly (₱)</label>
              <input type="number" min="0" value={modal.monthlyDue}
                onChange={(e) => setModal((m) => ({ ...m, monthlyDue: e.target.value }))} />
            </div>
            <div className="field full">
              <label>Notes</label>
              <input value={modal.notes} onChange={(e) => setModal((m) => ({ ...m, notes: e.target.value }))} />
            </div>
          </div>

          <ProcedurePicker catalog={catalog} value={modal.procedures}
            onChange={(v) => setModal((m) => ({ ...m, procedures: v }))} />
          <FreebieRows catalog={catalog} value={modal.freebies} onChange={(v) => setModal((m) => ({ ...m, freebies: v }))} />

          <p style={{ fontSize: '.85rem', color: 'var(--ink-soft)' }}>
            Included procedures are covered by the package price — they aren&rsquo;t billed separately.
            Price, downpayment and monthly are defaults; each patient&rsquo;s plan can override them.
          </p>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            <button className="btn quiet" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn" disabled={busy || !modal.name || modal.defaultPrice === ''} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
