const colors = {
  SCHEDULED: 'gray', CONFIRMED: 'blue', ARRIVED: 'amber', IN_CHAIR: 'green', COMPLETED: 'green',
  CANCELLED: 'gray', NO_SHOW: 'red', ACTIVE: 'green', PAID: 'green',
  AVAILABLE: 'green', USED: 'gray', VOIDED: 'gray', REFUNDED: 'amber',
}
const labels = {
  SCHEDULED: 'Scheduled', CONFIRMED: 'Confirmed', ARRIVED: 'Arrived', IN_CHAIR: 'In chair',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show', ACTIVE: 'Active',
  PAID: 'Paid',
  AVAILABLE: 'Available', USED: 'Used', VOIDED: 'Voided', REFUNDED: 'Refunded',
}
export default function StatusBadge({ value }) {
  return <span className={`badge ${colors[value] ?? 'gray'}`}>{labels[value] ?? value}</span>
}
