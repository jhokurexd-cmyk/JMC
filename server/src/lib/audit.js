import { prisma } from './prisma.js'

// Fire-and-forget audit writer. Never blocks or fails the main request.
export function audit({ userId, action, entity, entityId, detail }) {
  prisma.auditLog
    .create({ data: { userId: userId ?? null, action, entity, entityId, detail } })
    .catch((e) => console.error('audit write failed:', e.message))
}
