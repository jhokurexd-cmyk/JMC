import { useEffect } from 'react'

// Pass `busy` while a submit is in flight to block accidental dismissal
// (backdrop click / Escape) that would discard a half-entered form.
export default function Modal({ title, onClose, children, busy = false }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="modal" role="dialog" aria-label={title} aria-busy={busy}>
        <button
          type="button"
          className="modal-x"
          aria-label="Close"
          onClick={() => !busy && onClose()}
          disabled={busy}
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            border: 'none',
            background: 'none',
            fontSize: '1.3rem',
            lineHeight: 1,
            cursor: busy ? 'default' : 'pointer',
            color: 'var(--ink-soft)',
            opacity: busy ? 0.4 : 1,
          }}
        >
          ×
        </button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
