import { useEffect, useState } from 'react'
import { addDays, format, isSameDay, startOfWeek } from 'date-fns'
import { get } from '../lib/api'

// Appointments per day for the current week (Mon–Sun), cancelled excluded.
export default function WeekBars() {
  const [days, setDays] = useState(null)

  useEffect(() => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 })
    const end = addDays(start, 7)
    const list = Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), count: 0 }))
    get(`/appointments?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`)
      .then((rows) => {
        for (const a of rows) {
          if (a.status === 'CANCELLED') continue
          const d = list.find((x) => isSameDay(x.date, new Date(a.startsAt)))
          if (d) d.count++
        }
        setDays(list)
      })
      .catch(() => setDays(list))
  }, [])

  if (!days) return <div className="empty">Loading…</div>

  const peak = Math.max(...days.map((d) => d.count))
  const max = Math.max(4, Math.ceil(peak / 4) * 4)
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0]
  const today = new Date()

  return (
    <div className="bars" role="img" aria-label={`Appointments this week: ${days.map((d) => `${format(d.date, 'EEE')} ${d.count}`).join(', ')}`}>
      <div className="y">{ticks.map((t) => <span key={t}>{t}</span>)}</div>
      <div className="plot">
        {days.map((d) => (
          <div key={d.date.toISOString()} className={`col${isSameDay(d.date, today) ? ' today' : ''}`}>
            <div className="bar" style={{ height: `${(d.count / max) * 100}%` }} />
            <span className="tip">{format(d.date, 'EEE, MMM d')} · {d.count} appt{d.count === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
      <div className="x">
        {days.map((d) => (
          <span key={d.date.toISOString()} className={isSameDay(d.date, today) ? 'today' : ''}>{format(d.date, 'EEE')}</span>
        ))}
      </div>
    </div>
  )
}
