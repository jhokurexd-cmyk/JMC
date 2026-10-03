const inp = { border: '1px solid var(--line)', borderRadius: 6, padding: '7px 8px' }

// Coerce a legacy freebie ({ item, note?, given? }) or new-shape row into the
// tracked shape: { id?, name, procedureId, qtyIncluded, notes }.
export function normalizeFreebie(f) {
  return {
    id: f.id,
    name: f.name ?? f.item ?? '',
    procedureId: f.procedureId ?? '',
    qtyIncluded: f.qtyIncluded ?? 1,
    notes: f.notes ?? f.note ?? '',
  }
}

// Editable list of package benefits / freebies. A row may link to a catalog
// procedure (so a visit for that procedure can consume it) and carries a
// quantity — e.g. "Free Fillings ×2". `locked(row)` disables quantity edits
// below what's already been used/voided on a live plan.
export default function FreebieRows({ value, onChange, catalog = [], minQty }) {
  const rows = value ?? []
  const set = (i, k, v) => onChange(rows.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))
  const add = () => onChange([...rows, { name: '', procedureId: '', qtyIncluded: 1, notes: '' }])
  const remove = (i) => onChange(rows.filter((_, idx) => idx !== i))

  return (
    <div className="field">
      <label>Package benefits &amp; freebies</label>
      {rows.map((f, i) => (
        <div key={f.id ?? i} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1.3fr 70px 1fr auto', gap: 8, marginBottom: 6, alignItems: 'center' }}>
          <input placeholder="e.g. Free Fillings" value={f.name} onChange={(e) => set(i, 'name', e.target.value)} style={inp} />
          <select value={f.procedureId || ''} onChange={(e) => set(i, 'procedureId', e.target.value)} style={inp}>
            <option value="">— not a procedure —</option>
            {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="number" min={minQty?.(f) ?? 1} title="Quantity included" value={f.qtyIncluded}
            onChange={(e) => set(i, 'qtyIncluded', Math.max(1, Number(e.target.value) || 1))} style={inp} />
          <input placeholder="note (optional)" value={f.notes ?? ''} onChange={(e) => set(i, 'notes', e.target.value)} style={inp} />
          <button className="btn quiet" onClick={() => remove(i)} title="Remove">✕</button>
        </div>
      ))}
      <button className="btn ghost" onClick={add} style={{ marginTop: 4 }}>+ Add benefit</button>
      <p style={{ fontSize: '.78rem', color: 'var(--ink-soft)', margin: '4px 0 0' }}>
        Link a benefit to a procedure (e.g. Filling) to make it a consumable — staff can then mark items
        free during a visit. Benefits never affect the package money balance.
      </p>
    </div>
  )
}
