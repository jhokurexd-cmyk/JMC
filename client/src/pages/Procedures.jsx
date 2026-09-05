import { useEffect, useState } from 'react'
import { get, post, patch, del } from '../lib/api'
import { peso } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'

export default function Procedures() {
  const { user } = useAuth()
  const canEdit = user?.role === 'OWNER' || user?.role === 'DENTIST'
  const [procedures, setProcedures] = useState([])
  const [modal, setModal] = useState(null) // { id?, name, category, defaultPrice }
  const [busy, setBusy] = useState(false)
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
    await del(`/procedures/${p.id}`).catch(() => {})
    load()
  }

  return (
    <>
      <div className="page-head">
        <h1>Procedure catalog</h1>
        {canEdit && (
          <button className="btn" onClick={() => setModal({ name: '', category: '', defaultPrice: '' })}>
            Add procedure
          </button>
        )}
      </div>
      <div className="card">
        {procedures.length === 0 ? (
          <div className="empty">No procedures yet. Run the seed script or add them here.</div>
        ) : (
          <table className="data">
            <thead>
              <tr><th>Procedure</th><th>Category</th><th className="num">Default price</th>{canEdit && <th></th>}</tr>
            </thead>
            <tbody>
              {procedures.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.category || '—'}</td>
                  <td className="num">{peso(p.defaultPrice)}</td>
                  {canEdit && (
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn quiet" onClick={() => setModal({ ...p })}>Edit</button>{' '}
                      <button className="btn quiet" onClick={() => remove(p)}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <Modal title={modal.id ? 'Edit procedure' : 'Add procedure'} onClose={() => setModal(null)}>
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
