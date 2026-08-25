import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import AppShell from './components/AppShell'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import AdminDashboard from './pages/AdminDashboard'
import AllComplaints from './pages/AllComplaints'
import AuditTrail from './pages/AuditTrail'
import CitizenHome from './pages/CitizenHome'
import ComplaintDetail from './pages/ComplaintDetail'
import Login from './pages/Login'
import NewComplaint from './pages/NewComplaint'
import Register from './pages/Register'
import RiskQueue from './pages/RiskQueue'
import TaskInbox from './pages/TaskInbox'
import Users from './pages/Users'
import WardRisk from './pages/WardRisk'
import type { UserRole } from './lib/types'

/** Everything inside the app shell, gated by role. */
function Shell({ children, roles }: { children: ReactNode; roles?: UserRole[] }) {
  return (
    <ProtectedRoute roles={roles}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  )
}

/**
 * "/" means something different to each role, so it dispatches rather than
 * rendering one page with three modes inside it.
 */
function RoleHome() {
  const { user } = useAuth()
  if (!user) return null

  switch (user.role) {
    case 'ADMIN':
      return <AdminDashboard />
    case 'FIELD_OFFICIAL':
      return <TaskInbox scope="active" />
    default:
      return <CitizenHome />
  }
}

export default function App() {
  return (
    <Routes>
      {/* Auth screens render outside the shell — there is no navigation to show. */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        path="/"
        element={
          <Shell>
            <RoleHome />
          </Shell>
        }
      />

      {/* Citizen */}
      <Route
        path="/complaints/new"
        element={
          <Shell roles={['CITIZEN', 'ADMIN']}>
            <NewComplaint />
          </Shell>
        }
      />

      {/* Shared: the detail view scopes itself to what the caller may see. */}
      <Route
        path="/complaints/:id"
        element={
          <Shell>
            <ComplaintDetail />
          </Shell>
        }
      />

      {/* Field official */}
      <Route
        path="/tasks/done"
        element={
          <Shell roles={['FIELD_OFFICIAL', 'ADMIN']}>
            <TaskInbox scope="done" />
          </Shell>
        }
      />
      {/* An official following a task deep-link lands on the same detail page. */}
      <Route path="/tasks/:id" element={<Navigate to="/" replace />} />

      {/* Supervisor */}
      <Route
        path="/complaints"
        element={
          <Shell roles={['ADMIN']}>
            <AllComplaints />
          </Shell>
        }
      />
      <Route
        path="/risk"
        element={
          <Shell roles={['ADMIN']}>
            <RiskQueue />
          </Shell>
        }
      />
      <Route
        path="/wards"
        element={
          <Shell roles={['ADMIN']}>
            <WardRisk />
          </Shell>
        }
      />
      <Route
        path="/users"
        element={
          <Shell roles={['ADMIN']}>
            <Users />
          </Shell>
        }
      />
      <Route
        path="/audit"
        element={
          <Shell roles={['ADMIN']}>
            <AuditTrail />
          </Shell>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
