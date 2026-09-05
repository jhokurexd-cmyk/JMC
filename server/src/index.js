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
import procedureRoutes from './routes/procedures.js'
import appointmentRoutes from './routes/appointments.js'
import reportRoutes from './routes/reports.js'

const app = express()

app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }))
app.use(express.json())
app.use(cookieParser())

app.get('/api/v1/health', (req, res) => res.json({ ok: true }))

app.use('/api/v1/auth', authRoutes)

// everything below requires a signed-in user
app.use('/api/v1', requireAuth)
app.use('/api/v1/patients/:patientId/visits', visitRoutes)
app.use('/api/v1/patients/:patientId/ledger', ledgerRoutes)
app.use('/api/v1/patients/:patientId/plans', planRoutes)
app.use('/api/v1/patients', patientRoutes)
app.use('/api/v1/procedures', procedureRoutes)
app.use('/api/v1/appointments', appointmentRoutes)
app.use('/api/v1/reports', reportRoutes)

app.use(errorHandler)

const port = process.env.PORT ?? 4000
app.listen(port, () => console.log(`API running on http://localhost:${port}`))
