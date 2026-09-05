const colors = {
  SCHEDULED: 'teal', ARRIVED: 'amber', IN_CHAIR: 'amber', COMPLETED: 'green',
  CANCELLED: 'gray', NO_SHOW: 'red', ACTIVE: 'teal', PAID: 'green',
}
const labels = {
  SCHEDULED: 'Scheduled', ARRIVED: 'Arrived', IN_CHAIR: 'In chair',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled', NO_SHOW: 'No-show', ACTIVE: 'Active',
}
export default function StatusBadge({ value }) {
  return <span className={`badge ${colors[value] ?? 'gray'}`}>{labels[value] ?? value}</span>
}
