import { HttpError } from '../middleware/errors.js'
import { activeEntries } from './entries.js'

// Payment methods accepted anywhere a payment is recorded (matches the
// PaymentMethod enum in schema.prisma).
export const PAYMENT_METHODS = ['CASH', 'GCASH', 'BANK_TRANSFER', 'CARD', 'HMO', 'OTHER']

const peso = (n) => '₱' + Number(n).toLocaleString('en-PH')
const cents = (n) => Math.round(Number(n) * 100)

// A braces package is billed monthly: creating it writes no up-front charge; each
// monthly adjustment writes a CHARGE linked to the plan, and paying those charges
// is what pays the package down. So `paid` = every PAYMENT that goes *toward* the
// plan — either directly (planId) or by settling one of the plan's charges
// (appliesToId points at a plan CHARGE). `remaining` is computed, never stored.
export function planTotals(plan, rawEntries) {
  const allEntries = activeEntries(rawEntries)
  const planChargeIds = new Set(
    allEntries.filter((e) => e.type === 'CHARGE' && e.planId === plan.id).map((e) => e.id),
  )
  const paid = allEntries
    .filter(
      (e) =>
        e.type === 'PAYMENT' && (e.planId === plan.id || (e.appliesToId && planChargeIds.has(e.appliesToId))),
    )
    .reduce((s, e) => s + Number(e.amount), 0)
  return { paid, remaining: Number(plan.totalPrice) - paid }
}

const ENTRY_COLS = {
  select: { id: true, type: true, amount: true, planId: true, appliesToId: true, reversalOfId: true },
}

// Re-derive plan status: PAID once nothing is left to pay, else ACTIVE. A
// CANCELLED plan is never touched. Call inside a tx.
export async function syncPlanStatus(tx, planId) {
  const plan = await tx.treatmentPlan.findUnique({ where: { id: planId } })
  if (!plan || plan.status === 'CANCELLED') return plan?.status
  const all = await tx.ledgerEntry.findMany({ where: { patientId: plan.patientId }, ...ENTRY_COLS })
  const { remaining } = planTotals(plan, all)
  const next = cents(remaining) <= 0 ? 'PAID' : 'ACTIVE'
  if (next !== plan.status) {
    await tx.treatmentPlan.update({ where: { id: planId }, data: { status: next } })
  }
  return next
}

// Record a payment directly against a plan (e.g. a pre-payment from the plan
// card), capped at the remaining balance, then re-derive status. Inside a tx.
// The PAYMENT gets a receipt number and a Total-Due snapshot (before/after).
export async function recordPlanPayment(tx, { plan, patientId, amount, method, note, userId }) {
  if (plan.status === 'CANCELLED') throw new HttpError(400, 'This plan is cancelled')
  const all = await tx.ledgerEntry.findMany({ where: { patientId: plan.patientId }, ...ENTRY_COLS })
  const { remaining } = planTotals(plan, all)
  if (cents(amount) > cents(remaining)) {
    throw new HttpError(
      400,
      `Payment ${peso(amount)} exceeds the remaining balance ${peso(Math.max(0, remaining))}`,
    )
  }
  const { nextReceiptNo } = await import('./receipts.js')
  const { patientDue } = await import('./balance.js')
  const balanceBefore = await patientDue(patientId, tx)
  const created = await tx.ledgerEntry.create({
    data: {
      patientId,
      type: 'PAYMENT',
      amount,
      method: method ?? null,
      note: note ?? null,
      planId: plan.id,
      receiptNo: await nextReceiptNo(tx),
      balanceBefore,
      createdBy: userId,
    },
  })
  const status = await syncPlanStatus(tx, plan.id)
  const entry = await tx.ledgerEntry.update({
    where: { id: created.id },
    data: { balanceAfter: await patientDue(patientId, tx) },
  })
  return { entry, status }
}

// Current remaining on a plan, for callers outside a tx-payment (e.g. capping a
// monthly adjustment charge). Pass a Prisma client or tx.
export async function planRemaining(db, planId) {
  const plan = await db.treatmentPlan.findUnique({ where: { id: planId } })
  if (!plan) return null
  const all = await db.ledgerEntry.findMany({ where: { patientId: plan.patientId }, ...ENTRY_COLS })
  return { plan, ...planTotals(plan, all) }
}
