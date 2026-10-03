// One-off: convert legacy TreatmentPlan.freebies JSON (`[{ item, note?, given? }]`)
// into tracked PlanFreebie rows (name = item, qtyIncluded = 1, no linked
// procedure). Idempotent — skips a plan that already has PlanFreebie rows.
//
//   node scripts/backfill-freebies.mjs

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const plans = await prisma.treatmentPlan.findMany({
  select: { id: true, name: true, freebies: true, planFreebies: { select: { id: true } } },
})

let made = 0
for (const p of plans) {
  if (p.planFreebies.length > 0) continue
  const legacy = Array.isArray(p.freebies) ? p.freebies : []
  const rows = legacy
    .map((f) => (typeof f === 'string' ? { name: f } : f))
    .map((f) => ({ name: (f.name ?? f.item ?? '').trim(), notes: (f.note ?? '').trim() || null }))
    .filter((f) => f.name)
  if (rows.length === 0) continue
  await prisma.planFreebie.createMany({
    data: rows.map((r) => ({ planId: p.id, name: r.name, qtyIncluded: 1, notes: r.notes })),
  })
  made += rows.length
  console.log(`  ${p.name}: +${rows.length} benefit(s)`)
}

console.log(`\nDone. Created ${made} PlanFreebie row(s).`)
await prisma.$disconnect()
