import { HttpError } from '../middleware/errors.js'
import { syncPlanStatus } from './plans.js'
import { activeEntries, reversedEntryIds } from './entries.js'
import { patientDue } from './balance.js'
import { nextReceiptNo } from './receipts.js'

const peso = (n) => '₱' + Number(n).toLocaleString('en-PH')
const cents = (n) => Math.round(Number(n) * 100)

// Annotate every CHARGE with how much has been allocated to it, and tag every row
// with `voided` / `isReversal`. Every PAYMENT row also gets `paymentStatus`
// (`PAID` / `VOIDED` / `REFUNDED`). Nothing stored — all derived from the list.
export function enrichEntries(entries) {
  const reversedIds = reversedEntryIds(entries)
  const live = activeEntries(entries)

  const reversalKindByOriginal = {}
  for (const e of entries) {
    if (e.reversalOfId) reversalKindByOriginal[e.reversalOfId] = e.reversalKind || 'VOID'
  }

  const allocated = {}
  for (const e of live) {
    if (e.appliesToId) allocated[e.appliesToId] = (allocated[e.appliesToId] ?? 0) + Number(e.amount)
  }
  return entries.map((e) => {
    const flags = { voided: reversedIds.has(e.id), isReversal: Boolean(e.reversalOfId) }
    if (e.type === 'PAYMENT') {
      const paymentStatus = flags.isReversal
        ? null
        : reversalKindByOriginal[e.id] === 'REFUND'
          ? 'REFUNDED'
          : flags.voided
            ? 'VOIDED'
            : 'PAID'
      return { ...e, ...flags, paymentStatus }
    }
    if (e.type !== 'CHARGE') return { ...e, ...flags }
    const paid = allocated[e.id] ?? 0
    const remaining = Number(e.amount) - paid
    const payStatus = cents(remaining) <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID'
    return { ...e, ...flags, allocated: paid, remaining, payStatus }
  })
}

// Charges a payment can be applied to: any unpaid CHARGE — standalone ones and
// monthly braces-package installment charges (planId set). Legacy up-front package
// charges ("Treatment plan: …", from before monthly billing) are excluded, and so
// are voided / reversal rows.
export function openCharges(enriched) {
  return enriched
    .filter(
      (e) =>
        e.type === 'CHARGE' &&
        !e.voided &&
        !e.isReversal &&
        cents(e.remaining) > 0 &&
        !(e.planId && (e.note ?? '').startsWith('Treatment plan:')),
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((e) => ({
      id: e.id,
      note: e.note,
      planName: e.plan?.name ?? null,
      amount: e.amount,
      allocated: e.allocated,
      remaining: e.remaining,
      createdAt: e.createdAt,
    }))
}

// A real PAYMENT gets a receipt number and a Total-Due snapshot (before/after)
// so the printed receipt is stable. DISCOUNT/CHARGE rows get neither.
async function stampPayment(tx, { patientId, type, base }) {
  if (type !== 'PAYMENT') return base
  const balanceBefore = await patientDue(patientId, tx)
  return { ...base, receiptNo: await nextReceiptNo(tx), balanceBefore }
}

// Record a PAYMENT/DISCOUNT against one specific CHARGE, capped at what that charge
// still owes (voided allocations don't count). Call inside prisma.$transaction.
// Returns { entry, planStatus }.
export async function recordChargePayment(tx, { charge, patientId, type, amount, method, note, userId }) {
  const siblings = await tx.ledgerEntry.findMany({
    where: { patientId },
    select: { id: true, amount: true, appliesToId: true, reversalOfId: true },
  })
  const prior = activeEntries(siblings)
    .filter((e) => e.appliesToId === charge.id)
    .reduce((s, e) => s + Number(e.amount), 0)
  const remaining = Number(charge.amount) - prior
  if (cents(amount) > cents(remaining)) {
    throw new HttpError(400, `That's more than the ${peso(Math.max(0, remaining))} still owed on this charge`)
  }
  const data = await stampPayment(tx, {
    patientId,
    type,
    base: {
      patientId,
      type,
      amount,
      method: method ?? null,
      note: note ?? null,
      appliesToId: charge.id,
      createdBy: userId,
    },
  })
  let entry = await tx.ledgerEntry.create({ data })
  const planStatus = charge.planId ? await syncPlanStatus(tx, charge.planId) : null
  if (type === 'PAYMENT') {
    entry = await tx.ledgerEntry.update({
      where: { id: entry.id },
      data: { balanceAfter: await patientDue(patientId, tx) },
    })
  }
  return { entry, planStatus }
}

// Append a reversal entry that voids or refunds a prior PAYMENT/DISCOUNT. Mirrors
// the original and links back via reversalOfId. `kind` is 'VOID' (default) or
// 'REFUND'; a refund also records the method the money went back by. Balance
// effect is identical either way. Call inside prisma.$transaction.
export async function reverseEntry(tx, { original, reason, kind = 'VOID', refundMethod, userId }) {
  if (original.type === 'CHARGE') throw new HttpError(400, 'Charges cannot be voided — record a correcting discount instead')
  if (original.reversalOfId) throw new HttpError(400, 'That entry is itself a reversal')
  const already = await tx.ledgerEntry.findFirst({ where: { reversalOfId: original.id }, select: { id: true } })
  if (already) throw new HttpError(400, 'That entry has already been reversed')

  const balanceBefore = await patientDue(original.patientId, tx)
  const verb = kind === 'REFUND' ? 'Refund' : 'Void'
  let entry = await tx.ledgerEntry.create({
    data: {
      patientId: original.patientId,
      type: original.type,
      amount: original.amount,
      method: original.method ?? null,
      note: `${verb}: ` + (reason?.trim() || original.note || `${original.type.toLowerCase()} reversed`),
      planId: original.planId ?? null,
      appliesToId: original.appliesToId ?? null,
      reversalOfId: original.id,
      reversalKind: kind,
      refundMethod: kind === 'REFUND' ? refundMethod ?? null : null,
      balanceBefore,
      createdBy: userId,
    },
  })

  let planStatus = null
  if (original.planId) {
    planStatus = await syncPlanStatus(tx, original.planId)
  } else if (original.appliesToId) {
    const target = await tx.ledgerEntry.findUnique({ where: { id: original.appliesToId }, select: { planId: true } })
    if (target?.planId) planStatus = await syncPlanStatus(tx, target.planId)
  }
  entry = await tx.ledgerEntry.update({
    where: { id: entry.id },
    data: { balanceAfter: await patientDue(original.patientId, tx) },
  })
  return { entry, planStatus }
}
