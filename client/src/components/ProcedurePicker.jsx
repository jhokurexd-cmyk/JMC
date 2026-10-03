// Pick catalog procedures a package covers: value is [{ procedureId, name }].
export default function ProcedurePicker({ catalog, value, onChange, label = 'Included procedures' }) {
  const rows = value ?? []
  const chosen = new Set(rows.map((r) => r.procedureId).filter(Boolean))

  const addById = (id) => {
    const p = catalog.find((c) => c.id === id)
    if (!p || chosen.has(id)) return
    onChange([...rows, { procedureId: p.id, name: p.name }])
  }
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i))

  return (
    <div className="field">
      <label>{label}</label>
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {rows.map((r, i) => (
            <span key={i} className="badge teal" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {r.name}
              <button onClick={() => remove(i)} title="Remove"
                style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 700 }}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <select value="" onChange={(e) => { addById(e.target.value); e.target.value = '' }}
        style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }}>
        <option value="">+ Add procedure…</option>
        {catalog.filter((c) => !chosen.has(c.id)).map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}
