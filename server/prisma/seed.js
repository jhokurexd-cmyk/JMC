import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

const procedures = [
  ['Consultation', 'General', 500],
  ['Oral Prophylaxis (Cleaning)', 'General', 1000],
  ['Tooth Extraction (Simple)', 'Surgery', 1500],
  ['Tooth Extraction (Surgical)', 'Surgery', 5000],
  ['Composite Filling (per tooth)', 'Restorative', 1500],
  ['Temporary Filling', 'Restorative', 800],
  ['Root Canal Treatment (Anterior)', 'Endodontics', 8000],
  ['Root Canal Treatment (Molar)', 'Endodontics', 12000],
  ['Dental Crown (Porcelain)', 'Prosthodontics', 12000],
  ['Complete Denture (per arch)', 'Prosthodontics', 20000],
  ['Partial Denture', 'Prosthodontics', 8000],
  ['Teeth Whitening', 'Cosmetic', 10000],
  ['Braces Adjustment', 'Orthodontics', 1000],
  ['Retainers (per arch)', 'Orthodontics', 5000],
  ['Panoramic X-ray', 'Diagnostics', 1200],
  ['Periapical X-ray', 'Diagnostics', 400],
  ['Fluoride Treatment', 'Preventive', 800],
  ['Dental Sealant (per tooth)', 'Preventive', 700],
]

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'owner@clinic.local'
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!'

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Clinic Owner',
      role: 'OWNER',
      passwordHash: await argon2.hash(password),
    },
  })
  console.log(`Admin user ready: ${email}`)

  const count = await prisma.procedure.count()
  if (count === 0) {
    await prisma.procedure.createMany({
      data: procedures.map(([name, category, defaultPrice]) => ({
        name,
        category,
        defaultPrice,
      })),
    })
    console.log(`Seeded ${procedures.length} procedures`)
  } else {
    console.log('Procedures already present, skipping')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
