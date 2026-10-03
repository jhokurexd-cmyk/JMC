// A voided ledger entry and the reversal row that voids it cancel out.
// Every money calculation (Total Due, package paid/remaining, income,
// per-charge paid status) filters the entry list through this first, so a void
// behaves exactly as if the payment never happened — without editing or
// deleting any row. The ledger stays append-only; the rows just stop counting.
//
// `reversalOfId` is set on the reversal row and points at the entry it voids.
export function activeEntries(entries) {
  const reversedIds = new Set()
  for (const e of entries) if (e.reversalOfId) reversedIds.add(e.reversalOfId)
  return entries.filter((e) => !e.reversalOfId && !reversedIds.has(e.id))
}

// Ids of entries that have been voided by a later reversal row.
export function reversedEntryIds(entries) {
  const ids = new Set()
  for (const e of entries) if (e.reversalOfId) ids.add(e.reversalOfId)
  return ids
}
