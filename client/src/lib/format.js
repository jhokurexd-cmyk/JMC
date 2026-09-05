import { format } from 'date-fns'

export const peso = (n) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(n ?? 0)

export const fmtDate = (d) => (d ? format(new Date(d), 'MMM d, yyyy') : '—')
export const fmtDateTime = (d) => (d ? format(new Date(d), 'MMM d, yyyy h:mm a') : '—')
export const fmtTime = (d) => (d ? format(new Date(d), 'h:mm a') : '—')

export const fullName = (p) =>
  [p.lastName, p.firstName].filter(Boolean).join(', ') || '(no name)'
