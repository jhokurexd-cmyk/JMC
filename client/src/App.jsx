import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import { Loading } from './components/LoadState'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Patients from './pages/Patients'

const PatientDetail = lazy(() => import('./pages/PatientDetail'))
const PatientStatement = lazy(() => import('./pages/PatientStatement'))
const PaymentReceipt = lazy(() => import('./pages/PaymentReceipt'))
const Appointments = lazy(() => import('./pages/Appointments'))
const Procedures = lazy(() => import('./pages/Procedures'))
const Reports = lazy(() => import('./pages/Reports'))
const Income = lazy(() => import('./pages/Income'))
const Activity = lazy(() => import('./pages/Activity'))

function Protected({ children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div style={{ paddingTop: '20vh' }}><Loading /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Suspense fallback={<Loading />}>{children}</Suspense>
}

const page = (el) => <Suspense fallback={<Loading />}>{el}</Suspense>

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/patients/:id/statement" element={<Protected><PatientStatement /></Protected>} />
      <Route path="/patients/:id/receipt/:entryId" element={<Protected><PaymentReceipt /></Protected>} />
      <Route path="/" element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="patients" element={<Patients />} />
        <Route path="patients/:id" element={page(<PatientDetail />)} />
        <Route path="appointments" element={page(<Appointments />)} />
        <Route path="procedures" element={page(<Procedures />)} />
        <Route path="reports" element={page(<Reports />)} />
        <Route path="income" element={page(<Income />)} />
        <Route path="activity" element={page(<Activity />)} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
