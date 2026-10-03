import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { validate } from '../middleware/validate.js'
import { asyncRoute, HttpError } from '../middleware/errors.js'
import { audit } from '../lib/audit.js'
import { recordPlanPayment } from '../lib/plans.js'
import { enrichEntries, openCharges, recordChargePayment, reverseEntry } from '../lib/ledger.js'
import { patientDue } from '../lib/balance.js'
import { nextReceiptNo } from '../lib/receipts.js'

// The ledger is APPEND-ONLY. There is deliberately no PATCH or DELETE here.
// A wrong entry is fixed by adding a correcting entry (e.g. a DISCOUNT or
// an offsetting CHARGE) so the financial history stays auditable.
const router = Router({ mergeParams: true })

const entrySchema = z.object({
  type: z.enum(['CHARGE', 'PAYMENT', 'DISCOUNT']),
  amount: z.coerce.number().positive(),
  method: z.enum(['CASH', 'GCASH', 'BANK_TRANSFER', 'CARD', 'HMO', 'OTHER']).optional().nullable(),
  note: z.string().optional().nullable(),
  planId: z.string().uuid().optional().nullable(),
  appliesToId: z.string().uuid().optional().nullable(), // pay down one specific CHARGE
})

const voidSchema = z.object({ reason: z.string().max(200).optional().nullable() })
const refundSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(200),
  method: z.enum(['CASH', 'GCASH', 'BANK_TRANSFER', 'CARD', 'HMO', 'OTHER']),
})

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const entries = await prisma.ledgerEntry.findMany({
      where: { patientId: req.params.patientId },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { name: true } },
        plan: { select: { name: true } },
        appliesTo: { select: { id: true, note: true } },
        reversedBy: { select: { id: true, reversalKind: true } },
        visitProcedure: {
          select: {
            quantity: true,
            items: true,
            priceCharged: true,
            coveredByFreebie: { select: { name: true } },
            procedure: { select: { name: true } },
            visit: { select: { id: true, visitDate: true } },
          },
        },
      },
    })
    const enriched = enrichEntries(entries)
    res.json({
      balance: await patientDue(req.params.patientId),
      entries: enriched,
      openCharges: openCharges(enriched),
    })
  }),
)

router.post(
  '/',
  validate(entrySchema),
  asyncRoute(async (req, res) => {
    const { patientId } = req.params

    if (req.body.planId && req.body.appliesToId) {
      throw new HttpError(400, 'Apply an entry to either a package or a single charge, not both')
    }

    // A payment applied to a treatment plan goes through recordPlanPayment so the
    // "can't exceed the remaining balance" rule and the automatic PAID status
    // apply no matter where the payment is entered from.
    if (req.body.type === 'PAYMENT' && req.body.planId) {
      const plan = await prisma.treatmentPlan.findUnique({
        where: { id: req.body.planId },
        include: { ledgerEntries: true },
      })
      if (!plan || plan.patientId !== patientId) {
        return res.status(404).json({ error: 'Plan not found' })
      }
      const { entry, status } = await prisma.$transaction((tx) =>
        recordPlanPayment(tx, {
          plan,
          patientId,
          amount: req.body.amount,
          method: req.body.method,
          note: req.body.note,
          userId: req.user.id,
        }),
      )
      audit({
        userId: req.user.id,
        action: 'CREATE',
        entity: 'ledger_entry',
        entityId: entry.id,
        detail: { type: entry.type, amount: entry.amount, planId: plan.id, receiptNo: entry.receiptNo ?? undefined },
      })
      if (status !== plan.status) {
        audit({
          userId: req.user.id,
          action: 'UPDATE',
          entity: 'treatment_plan',
          entityId: plan.id,
          detail: { status },
        })
      }
      return res.status(201).json(entry)
    }

    // A payment/discount applied to one specific charge: capped at what that
    // charge still owes, tracked by appliesToId. If the charge belongs to a
    // package (a monthly adjustment charge), paying it deducts from the package.
    if (req.body.appliesToId) {
      if (req.body.type === 'CHARGE') {
        throw new HttpError(400, 'A charge cannot be applied to another charge')
      }
      const charge = await prisma.ledgerEntry.findUnique({ where: { id: req.body.appliesToId } })
      if (!charge || charge.patientId !== patientId || charge.type !== 'CHARGE') {
        return res.status(404).json({ error: 'Charge not found' })
      }
      const { entry, planStatus } = await prisma.$transaction((tx) =>
        recordChargePayment(tx, {
          charge,
          patientId,
          type: req.body.type,
          amount: req.body.amount,
          method: req.body.method,
          note: req.body.note,
          userId: req.user.id,
        }),
      )
      audit({
        userId: req.user.id,
        action: 'CREATE',
        entity: 'ledger_entry',
        entityId: entry.id,
        detail: { type: entry.type, amount: entry.amount, appliesToId: charge.id, receiptNo: entry.receiptNo ?? undefined },
      })
      if (charge.planId && planStatus) {
        audit({
          userId: req.user.id,
          action: 'UPDATE',
          entity: 'treatment_plan',
          entityId: charge.planId,
          detail: { status: planStatus },
        })
      }
      return res.status(201).json(entry)
    }

    // Plain entry: a CHARGE, a DISCOUNT with no target, or a general PAYMENT
    // (not tied to a plan or a charge). A general PAYMENT still gets a receipt.
    const entry = await prisma.$transaction(async (tx) => {
      if (req.body.type !== 'PAYMENT') {
        return tx.ledgerEntry.create({ data: { ...req.body, patientId, createdBy: req.user.id } })
      }
      const balanceBefore = await patientDue(patientId, tx)
      const created = await tx.ledgerEntry.create({
        data: {
          ...req.body,
          patientId,
          createdBy: req.user.id,
          receiptNo: await nextReceiptNo(tx),
          balanceBefore,
        },
      })
      return tx.ledgerEntry.update({
        where: { id: created.id },
        data: { balanceAfter: await patientDue(patientId, tx) },
      })
    })
    audit({
      userId: req.user.id,
      action: 'CREATE',
      entity: 'ledger_entry',
      entityId: entry.id,
      detail: { type: entry.type, amount: entry.amount, receiptNo: entry.receiptNo ?? undefined },
    })
    res.status(201).json(entry)
  }),
)

// Void a PAYMENT or DISCOUNT by appending a linked reversal entry. Still no
// PATCH/DELETE — the original row stays; a void just makes it stop counting.
router.post(
  '/:entryId/void',
  validate(voidSchema),
  asyncRoute(async (req, res) => {
    const { patientId, entryId } = req.params
    const original = await prisma.ledgerEntry.findUnique({ where: { id: entryId } })
    if (!original || original.patientId !== patientId) {
      return res.status(404).json({ error: 'Entry not found' })
    }

    const { entry, planStatus } = await prisma.$transaction((tx) =>
      reverseEntry(tx, { original, reason: req.body.reason, kind: 'VOID', userId: req.user.id }),
    )
    audit({
      userId: req.user.id,
      action: 'VOID',
      entity: 'ledger_entry',
      entityId: entry.id,
      detail: {
        ofPayment: original.id,
        receiptNo: original.receiptNo ?? undefined,
        type: original.type,
        amount: original.amount,
        reason: req.body.reason?.trim() || undefined,
      },
    })
    if (planStatus) {
      const planId = original.planId ?? entry.planId ?? null
      if (planId) {
        audit({
          userId: req.user.id,
          action: 'UPDATE',
          entity: 'treatment_plan',
          entityId: planId,
          detail: { status: planStatus },
        })
      }
    }
    res.status(201).json(entry)
  }),
)

// Refund a PAYMENT — money physically returned to the patient. Same balance /
// income effect as a void (append a linked reversal); differs by label, a
// required reason, and recording the method the money went back by.
router.post(
  '/:entryId/refund',
  validate(refundSchema),
  asyncRoute(async (req, res) => {
    const { patientId, entryId } = req.params
    const original = await prisma.ledgerEntry.findUnique({ where: { id: entryId } })
    if (!original || original.patientId !== patientId) {
      return res.status(404).json({ error: 'Entry not found' })
    }
    if (original.type !== 'PAYMENT') {
      return res.status(400).json({ error: 'Only a payment can be refunded' })
    }

    const { entry, planStatus } = await prisma.$transaction((tx) =>
      reverseEntry(tx, {
        original,
        reason: req.body.reason,
        kind: 'REFUND',
        refundMethod: req.body.method,
        userId: req.user.id,
      }),
    )
    audit({
      userId: req.user.id,
      action: 'REFUND',
      entity: 'ledger_entry',
      entityId: entry.id,
      detail: {
        ofPayment: original.id,
        receiptNo: original.receiptNo ?? undefined,
        amount: original.amount,
        reason: req.body.reason.trim(),
        method: req.body.method,
      },
    })
    if (planStatus) {
      const planId = original.planId ?? entry.planId ?? null
      if (planId) {
        audit({
          userId: req.user.id,
          action: 'UPDATE',
          entity: 'treatment_plan',
          entityId: planId,
          detail: { status: planStatus },
        })
      }
    }
    res.status(201).json(entry)
  }),
)

export default router
