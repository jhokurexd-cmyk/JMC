export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><span className="spinner" />{label}</div>
}

export function LoadError({ error, onRetry }) {
  return (
    <div className="load-error">
      <strong>Couldn’t load this page</strong>
      {error?.message || 'Check your connection and try again.'}
      {onRetry && (
        <div style={{ marginTop: 12 }}>
          <button className="btn ghost" onClick={onRetry}>Try again</button>
        </div>
      )}
    </div>
  )
}
