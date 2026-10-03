// Package benefits ("freebies") are tracked consumables on a patient's plan.
// They are NON-MONETARY: nothing here touches planTotals / computeDue / the
// package balance. Current quantity and status are always DERIVED from the
// append-only PlanFreebieEntry log — mirrors the ledger reversal pattern.
//
//   used     = Σ USE.qty                 (permanent — visits aren't editable)
//   voided   = Σ VOID.qty − Σ RESTORE.qty (RESTORE only ever reverses a VOID)
//   remaining = max(0, qtyIncluded − used − voided)   (never below zero)

export function freebieTotals(freebie, entries) {
  let used = 0
  let voidGross = 0
  let restored = 0
  for (const e of entries) {
    if (e.type === 'USE') used += e.qty
    else if (e.type === 'VOID') voidGross += e.qty
    else if (e.type === 'RESTORE') restored += e.qty
  }
  const voided = Math.max(0, voidGross - restored)
  const remaining = Math.max(0, freebie.qtyIncluded - used - voided)
  const status =
    remaining > 0 ? 'AVAILABLE' : voided > 0 && used < freebie.qtyIncluded ? 'VOIDED' : 'USED'

  const label =
    freebie.qtyIncluded > 1
      ? `${used} of ${freebie.qtyIncluded} used · ${remaining} remaining${voided ? ` · ${voided} voided` : ''}`
      : status === 'AVAILABLE'
        ? 'Available'
        : status === 'VOIDED'
          ? 'Voided'
          : 'Claimed'

  return { used, voided, remaining, status, label }
}

// planId -> [{ ...freebie, used, voided, remaining, status, label, history }]
export async function freebiesForPlans(prisma, planIds) {
  if (planIds.length === 0) return {}
  const rows = await prisma.planFreebie.findMany({
    where: { planId: { in: planIds } },
    orderBy: { createdAt: 'asc' },
    include: {
      procedure: { select: { name: true } },
      entries: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { name: true } } },
      },
    },
  })
  const map = {}
  for (const id of planIds) map[id] = []
  for (const f of rows) {
    const totals = freebieTotals(f, f.entries)
    map[f.planId]?.push({
      id: f.id,
      planId: f.planId,
      name: f.name,
      procedureId: f.procedureId,
      procedureName: f.procedure?.name ?? null,
      qtyIncluded: f.qtyIncluded,
      notes: f.notes,
      ...totals,
      history: f.entries.map((e) => ({
        id: e.id,
        type: e.type,
        qty: e.qty,
        reason: e.reason,
        by: e.author?.name ?? null,
        createdAt: e.createdAt,
      })),
    })
  }
  return map
}

// Current remaining on one freebie (for the visit route's coverage cap).
export async function freebieRemaining(db, freebieId) {
  const freebie = await db.planFreebie.findUnique({
    where: { id: freebieId },
    include: { plan: { select: { id: true, patientId: true, status: true } }, entries: true },
  })
  if (!freebie) return null
  return { freebie, ...freebieTotals(freebie, freebie.entries) }
}
