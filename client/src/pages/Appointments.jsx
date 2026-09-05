import { useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { get, post, patch, del } from '../lib/api'
import { fullName } from '../lib/format'
import Modal from '../components/Modal'

const statusColors = {
  SCHEDULED: '#0e7c6b',
  ARRIVED: '#b45309',
  IN_CHAIR: '#b45309',
  COMPLETED: '#2e6b34',
  CANCELLED: '#8a938f',
  NO_SHOW: '#b3261e',
}

export default function Appointments() {
  const calendarRef = useRef(null)
  const [events, setEvents] = useState([])
  const [patients, setPatients] = useState([])
  const [modal, setModal] = useState(null) // { mode: 'create'|'edit', data }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = () =>
    get('/appointments').then((rows) =>
      setEvents(
        rows.map((a) => ({
          id: a.id,
          title: a.patientName,
          start: a.startsAt,
          end: a.endsAt,
          backgroundColor: statusColors[a.status],
          borderColor: statusColors[a.status],
          extendedProps: a,
        })),
      ),
    ).catch(() => {})

  useEffect(() => {
    load()
    get('/patients').then(setPatients).catch(() => {})
  }, [])

  const openCreate = (startStr) => {
    const start = startStr ? new Date(startStr) : new Date()
    const end = new Date(start.getTime() + 30 * 60000)
    setModal({
      mode: 'create',
      data: {
        patientId: '', patientName: '',
        startsAt: toLocalInput(start), endsAt: toLocalInput(end),
        note: '', status: 'SCHEDULED',
      },
    })
    setError('')
  }

  const openEdit = (info) => {
    const a = info.event.extendedProps
    setModal({
      mode: 'edit',
      data: {
        id: a.id, patientId: a.patientId ?? '', patientName: a.patientName,
        startsAt: toLocalInput(new Date(a.startsAt)), endsAt: toLocalInput(new Date(a.endsAt)),
        note: a.note ?? '', status: a.status,
      },
    })
    setError('')
  }

  const set = (k) => (e) => {
    const value = e.target.value
    setModal((m) => {
      const data = { ...m.data, [k]: value }
      if (k === 'patientId' && value) {
        const p = patients.find((x) => x.id === value)
        if (p) data.patientName = fullName(p)
      }
      return { ...m, data }
    })
  }

  const save = async () => {
    setBusy(true)
    setError('')
    const d = modal.data
    const body = {
      patientId: d.patientId || null,
      patientName: d.patientName,
      startsAt: new Date(d.startsAt).toISOString(),
      endsAt: new Date(d.endsAt).toISOString(),
      note: d.note || null,
      status: d.status,
    }
    try {
      if (modal.mode === 'create') {
        const created = await post('/appointments', body)
        if (created.conflict) {
          setNotice('Heads up: this overlaps another appointment.')
          setTimeout(() => setNotice(''), 5000)
        }
      } else {
        await patch(`/appointments/${d.id}`, body)
      }
      setModal(null)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Delete this appointment?')) return
    await del(`/appointments/${modal.data.id}`).catch(() => {})
    setModal(null)
    load()
  }

  // drag-to-reschedule
  const onEventChange = async (info) => {
    try {
      await patch(`/appointments/${info.event.id}`, {
        startsAt: info.event.start.toISOString(),
        endsAt: (info.event.end ?? new Date(info.event.start.getTime() + 30 * 60000)).toISOString(),
      })
    } catch {
      info.revert()
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Appointments</h1>
        <button className="btn" onClick={() => openCreate()}>Book appointment</button>
      </div>
      {notice && (
        <div className="alert-medical" style={{ background: 'var(--money-tint)', borderColor: '#f0d9b8', color: 'var(--money)' }}>
          {notice}
        </div>
      )}
      <div className="card">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' }}
          slotMinTime="07:00:00"
          slotMaxTime="20:00:00"
          height="auto"
          events={events}
          editable
          selectable
          dateClick={(info) => openCreate(info.dateStr)}
          eventClick={openEdit}
          eventDrop={onEventChange}
          eventResize={onEventChange}
        />
      </div>

      {modal && (
        <Modal title={modal.mode === 'create' ? 'Book appointment' : 'Edit appointment'} onClose={() => setModal(null)}>
          <div className="form-grid">
            <div className="field full">
              <label>Registered patient (or type a walk-in name below)</label>
              <select value={modal.data.patientId} onChange={set('patientId')}>
                <option value="">— Walk-in / not registered —</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{fullName(p)}</option>
                ))}
              </select>
            </div>
            <div className="field full">
              <label>Patient name</label>
              <input value={modal.data.patientName} onChange={set('patientName')} />
            </div>
            <div className="field">
              <label>Starts</label>
              <input type="datetime-local" value={modal.data.startsAt} onChange={set('startsAt')} />
            </div>
            <div className="field">
              <label>Ends</label>
              <input type="datetime-local" value={modal.data.endsAt} onChange={set('endsAt')} />
            </div>
            <div className="field">
              <label>Status</label>
              <select value={modal.data.status} onChange={set('status')}>
                <option value="SCHEDULED">Scheduled</option>
                <option value="ARRIVED">Arrived</option>
                <option value="IN_CHAIR">In chair</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="NO_SHOW">No-show</option>
              </select>
            </div>
            <div className="field">
              <label>Note</label>
              <input value={modal.data.note} onChange={set('note')} placeholder="e.g. Braces adjustment" />
            </div>
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '.9rem' }}>{error}</p>}
          <div className="actions">
            {modal.mode === 'edit' && (
              <button className="btn danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>
            )}
            <button className="btn quiet" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn" disabled={busy || !modal.data.patientName} onClick={save}>
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
