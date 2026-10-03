import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { get, post, patch, del } from '../lib/api'
import { fmtTime, fullName } from '../lib/format'
import Modal from '../components/Modal'
import PatientPicker from '../components/PatientPicker'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'

const STATUS_OPTS = [
  ['SCHEDULED', 'Scheduled'],
  ['CONFIRMED', 'Confirmed'],
  ['COMPLETED', 'Completed'],
  ['CANCELLED', 'Cancelled'],
  ['NO_SHOW', 'No-show'],
]
// [fill, edge] — pastel block with a stronger left edge; text stays dark ink.
const statusColors = {
  SCHEDULED: ['#eeedeb', '#8c8986'], CONFIRMED: ['#e3ecfa', '#2f5fa7'],
  ARRIVED: ['#fcebd7', '#b45309'], IN_CHAIR: ['#fcebd7', '#b45309'],
  COMPLETED: ['#e2f2e7', '#2e7d4a'], CANCELLED: ['#f3f3f2', '#c2c0bd'], NO_SHOW: ['#fbe4e2', '#b3261e'],
}
const statusLabel = (s) => (STATUS_OPTS.find(([v]) => v === s)?.[1]) || s

export default function Appointments() {
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const calendarRef = useRef(null)
  const [events, setEvents] = useState([])
  const [dentists, setDentists] = useState([])
  const [modal, setModal] = useState(null) // { mode, data, conflict? }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rangeRef = useRef({ from: null, to: null })

  const load = () => {
    const { from, to } = rangeRef.current
    const q = from && to ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` : ''
    return get(`/appointments${q}`).then((rows) =>
      setEvents(
        rows.map((a) => ({
          id: a.id,
          title: a.patientName,
          start: a.startsAt,
          end: a.endsAt,
          backgroundColor: statusColors[a.status]?.[0],
          borderColor: statusColors[a.status]?.[1],
          textColor: '#2b2a29',
          extendedProps: a,
        })),
      ),
    ).catch(() => {})
  }

  useEffect(() => {
    load() // safety net — datesSet refines the range once the calendar mounts
    get('/visit-performers').then(setDentists).catch(() => {})
  }, [])

  const blank = (start) => ({
    patientId: '', patientName: '', dentist: '',
    startsAt: toLocalInput(start), endsAt: toLocalInput(new Date(start.getTime() + 30 * 60000)),
    note: '', status: 'SCHEDULED',
  })
  const nextSlot = () => {
    const d = new Date()
    d.setMinutes(Math.ceil((d.getMinutes() + 1) / 15) * 15, 0, 0)
    return d
  }
  const openCreate = (startStr, preset = {}) => {
    setModal({ mode: 'create', data: { ...blank(startStr ? new Date(startStr) : nextSlot()), ...preset } })
    setError('')
  }

  // Deep link: /appointments?new=1[&patient=<id>] opens the booking form.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return
    const pid = searchParams.get('patient')
    setSearchParams((sp) => { sp.delete('new'); sp.delete('patient'); return sp }, { replace: true })
    if (!pid) return openCreate()
    get(`/patients/${pid}`)
      .then((p) => openCreate(null, { patientId: p.id, patientName: fullName(p) }))
      .catch(() => openCreate())
  }, [searchParams])
  const openEdit = (info) => {
    const a = info.event.extendedProps
    setModal({
      mode: 'edit',
      data: {
        id: a.id, patientId: a.patientId ?? '', patientName: a.patientName, dentist: a.dentist ?? '',
        startsAt: toLocalInput(new Date(a.startsAt)), endsAt: toLocalInput(new Date(a.endsAt)),
        note: a.note ?? '', status: a.status,
      },
    })
    setError('')
  }

  const set = (k) => (e) => {
    const value = e.target.value
    setModal((m) => ({ ...m, data: { ...m.data, [k]: value } }))
  }
  const pickPatient = (p) =>
    setModal((m) => ({
      ...m,
      data: { ...m.data, patientId: p?.id ?? '', patientName: p ? fullName(p) : '' },
    }))

  const save = async () => {
    setBusy(true)
    setError('')
    const d = modal.data
    const body = {
      patientId: d.patientId || null,
      patientName: d.patientName,
      dentist: d.dentist?.trim() || null,
      startsAt: new Date(d.startsAt).toISOString(),
      endsAt: new Date(d.endsAt).toISOString(),
      note: d.note || null,
      status: d.status,
    }
    try {
      const res = modal.mode === 'create'
        ? await post('/appointments', body)
        : await patch(`/appointments/${d.id}`, body)
      load()
      toast(modal.mode === 'create' ? `Booked ${d.patientName} · ${fmtTime(body.startsAt)}` : 'Appointment updated')
      // Keep the modal open in edit mode when the visit still needs recording;
      // otherwise close. Always surface any conflict from the response.
      if (d.status === 'COMPLETED' && (d.patientId || res.patientId)) {
        setModal({ mode: 'edit', data: { ...d, id: res.id }, conflict: res.conflict ? res : null, justCompleted: true })
      } else {
        setModal(res.conflict ? { mode: 'edit', data: { ...d, id: res.id }, conflict: res } : null)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Archive this appointment? (Prefer setting the status to Cancelled — it stays on the calendar history.)')) return
    setBusy(true)
    setError('')
    try {
      await del(`/appointments/${modal.data.id}`)
      setModal(null)
      load()
      toast('Appointment archived')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const startEnd = modal ? { s: new Date(modal.data.startsAt), e: new Date(modal.data.endsAt) } : null
  const badRange = startEnd && !(startEnd.e > startEnd.s)

  const onEventChange = async (info) => {
    try {
      await patch(`/appointments/${info.event.id}`, {
        startsAt: info.event.start.toISOString(),
        endsAt: (info.event.end ?? new Date(info.event.start.getTime() + 30 * 60000)).toISOString(),
      })
      load()
      toast(`Moved to ${fmtTime(info.event.start)}`)
    } catch (e) {
      info.revert()
      toast(e.message || 'Could not move the appointment', 'error')
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Appointments</h1>
          <div className="sub">Click an empty slot to book · drag to reschedule</div>
        </div>
        <button className="btn" onClick={() => openCreate()}><Icon name="plus" />Book appointment</button>
      </div>

      <div className="card">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          slotMinTime="07:00:00"
          slotMaxTime="20:00:00"
          slotDuration="00:15:00"
          slotLabelInterval="01:00"
          nowIndicator
          slotEventOverlap={false}
          eventMinHeight={22}
          height="auto"
          events={events}
          editable
          selectable
          datesSet={(arg) => {
            rangeRef.current = { from: arg.start.toISOString(), to: arg.end.toISOString() }
            load()
          }}
          dateClick={(info) => openCreate(info.dateStr)}
          eventClick={openEdit}
          eventDrop={onEventChange}
          eventResize={onEventChange}
          eventClassNames={(arg) => [`appt-${(arg.event.extendedProps.status || '').toLowerCase()}`]}
          eventContent={(arg) => {
            const a = arg.event.extendedProps
            return (
              <div style={{ overflow: 'hidden', fontSize: '.78rem', lineHeight: 1.25, padding: '1px 3px' }}>
                <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {arg.timeText} {a.patientName}
                </div>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.9 }}>
                  {statusLabel(a.status)}{a.dentist ? ` · ${a.dentist}` : ''}
                </div>
              </div>
            )
          }}
        />
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Book appointment' : 'Edit appointment'} onClose={() => setModal(null)} busy={busy}>
          {modal.conflict && (
            <div className="alert-medical" style={{
              marginBottom: 12,
              borderColor: modal.conflict.conflictSameDentist ? 'var(--danger)' : '#f0d9b8',
              color: modal.conflict.conflictSameDentist ? 'var(--danger)' : 'var(--money)',
              background: modal.conflict.conflictSameDentist ? 'rgba(179,38,30,.08)' : 'var(--money-tint)',
            }}>
              {modal.conflict.conflictSameDentist ? '⚠ Same dentist double-booked: ' : '⚠ Overlaps another appointment: '}
              {modal.conflict.conflictWith?.patientName} at{' '}
              {modal.conflict.conflictWith && fmtTime(modal.conflict.conflictWith.startsAt)}
              {modal.conflict.conflictWith?.dentist ? ` (${modal.conflict.conflictWith.dentist})` : ''}. Saved anyway.
            </div>
          )}
          {modal.justCompleted && modal.data.patientId && (
            <div className="alert-medical" style={{ marginBottom: 12, background: 'var(--primary-tint)', borderColor: 'var(--primary)', color: 'var(--primary)' }}>
              Marked completed. <button className="btn" style={{ marginLeft: 8, padding: '2px 10px' }}
                onClick={() => navigate(`/patients/${modal.data.patientId}?tab=visits&fromAppt=${modal.data.id}${modal.data.dentist ? `&dentist=${encodeURIComponent(modal.data.dentist)}` : ''}`)}>
                Record visit now →
              </button>
            </div>
          )}
          <div className="form-grid">
            <div className="field full">
              <label htmlFor="appt-patient">Patient</label>
              <PatientPicker id="appt-patient" value={modal.data.patientId} label={modal.data.patientName}
                onChange={pickPatient} />
            </div>
            {!modal.data.patientId && (
              <div className="field full">
                <label>Walk-in name</label>
                <input value={modal.data.patientName} onChange={set('patientName')} placeholder="Name for this walk-in" />
              </div>
            )}
            <div className="field">
              <label>Dentist</label>
              <input list="appt-dentists" value={modal.data.dentist} onChange={set('dentist')} placeholder="e.g. Dr. Cruz" />
              <datalist id="appt-dentists">{dentists.map((n) => <option key={n} value={n} />)}</datalist>
            </div>
            <div className="field">
              <label>Status</label>
              <select value={modal.data.status} onChange={set('status')}>
                {!STATUS_OPTS.some(([v]) => v === modal.data.status) && (
                  <option value={modal.data.status}>{statusLabel(modal.data.status)}</option>
                )}
                {STATUS_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Starts</label>
              <input type="datetime-local" value={modal.data.startsAt} onChange={set('startsAt')} />
            </div>
            <div className="field">
              <label>Ends</label>
              <input type="datetime-local" value={modal.data.endsAt} onChange={set('endsAt')} />
              {badRange && <span className="err">End time must be after the start time</span>}
            </div>
            <div className="field full">
              <label>Note</label>
              <input value={modal.data.note} onChange={set('note')} placeholder="e.g. Braces adjustment" />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="actions">
            {modal.mode === 'edit' && (
              <>
                <button className="btn danger" disabled={busy} onClick={remove} style={{ marginRight: 'auto' }}>
                  {busy ? 'Working…' : 'Archive'}
                </button>
                {modal.data.patientId && !modal.justCompleted && (
                  <button className="btn quiet"
                    onClick={() => navigate(`/patients/${modal.data.patientId}?tab=visits&fromAppt=${modal.data.id}${modal.data.dentist ? `&dentist=${encodeURIComponent(modal.data.dentist)}` : ''}`)}>
                    Record visit
                  </button>
                )}
              </>
            )}
            <button className="btn quiet" onClick={() => setModal(null)}>Close</button>
            <button className="btn" disabled={busy || !modal.data.patientName || badRange} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
