import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { requireAuth } from './middleware/auth.js'
import { errorHandler } from './middleware/errors.js'
import authRoutes from './routes/auth.js'
import patientRoutes from './routes/patients.js'
import visitRoutes from './routes/visits.js'
import ledgerRoutes from './routes/ledger.js'
import planRoutes from './routes/plans.js'
import fileRoutes from './routes/files.js'
import procedureRoutes from './routes/procedures.js'
import packageRoutes from './routes/packages.js'
import appointmentRoutes from './routes/appointments.js'
import reportRoutes from './routes/reports.js'
import feedRoutes from './routes/feed.js'
import performerRoutes from './routes/performers.js'
import freebieRoutes from './routes/freebies.js'
import auditRoutes from './routes/audit.js'

const app = express()

// On Vercel (demo deploy) this app runs as a function behind the `/api` route in
// vercel.json. Put the prefix back if the platform stripped it, so the routes
// below match either way. No effect on the clinic PC.
if (process.env.VERCEL) {
  app.use((req, res, next) => {
    if (!req.url.startsWith('/api/')) req.url = '/api' + req.url
    next()
  })
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }))
app.use(express.json())
app.use(cookieParser())

app.get('/api/v1/health', (req, res) => res.json({ ok: true }))

app.use('/api/v1/auth', authRoutes)
// public, token-gated report feed for spreadsheets — bypasses the JWT wall
app.use('/api/v1/feed', feedRoutes)

// everything below requires a signed-in user
app.use('/api/v1', requireAuth)
app.use('/api/v1/patients/:patientId/visits', visitRoutes)
app.use('/api/v1/patients/:patientId/ledger', ledgerRoutes)
app.use('/api/v1/patients/:patientId/plans/:planId/freebies', freebieRoutes)
app.use('/api/v1/patients/:patientId/plans', planRoutes)
app.use('/api/v1/patients/:patientId/files', fileRoutes)
app.use('/api/v1/patients', patientRoutes)
app.use('/api/v1/procedures', procedureRoutes)
app.use('/api/v1/packages', packageRoutes)
app.use('/api/v1/appointments', appointmentRoutes)
app.use('/api/v1/visit-performers', performerRoutes)
app.use('/api/v1/audit', auditRoutes)
app.use('/api/v1/reports', reportRoutes)

app.use(errorHandler)

// Vercel imports the app instead of running a long-lived server.
if (!process.env.VERCEL) {
  const port = process.env.PORT ?? 4000
  app.listen(port, () => console.log(`API running on http://localhost:${port}`))
}

export default app
