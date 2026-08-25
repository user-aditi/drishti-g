import { Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import AppShell from './components/AppShell'
import ProtectedRoute from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import AllComplaints from './pages/AllComplaints'
import AuditTrail from './pages/AuditTrail'
import CitizenHome from './pages/CitizenHome'
import ComplaintDetail from './pages/ComplaintDetail'
import ComplaintMap from './pages/ComplaintMap'
import Departments from './pages/Departments'
import Escalations from './pages/Escalations'
import Login from './pages/Login'
import NewComplaint from './pages/NewComplaint'
import OfficerDesk from './pages/OfficerDesk'
import OrgChart from './pages/OrgChart'
import Oversight from './pages/Oversight'
import People from './pages/People'
import Register from './pages/Register'
import RiskQueue from './pages/RiskQueue'
import SectorRisk from './pages/SectorRisk'
import WorkerJobs from './pages/WorkerJobs'
import type { Rank } from './lib/types'

/** Everything inside the app shell, optionally gated by a minimum rank. */
function Shell({ children, minRank }: { children: ReactNode; minRank?: Rank }) {
  return (
    <ProtectedRoute minRank={minRank}>
      <AppShell>{children}</AppShell>
    </ProtectedRoute>
  )
}

/**
 * "/" means something different at every level of the authority, so it
 * dispatches rather than rendering one page with five modes inside it.
 */
function RankHome() {
  const { user } = useAuth()
  if (!user) return null

  if (user.rank === 'CITIZEN') return <CitizenHome />
  if (user.rank === 'FIELD_WORKER') return <WorkerJobs scope="active" />
  if (user.rank === 'SECTION_OFFICER') return <OfficerDesk scope="active" />
  return <Oversight />
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
            <RankHome />
          </Shell>
        }
      />

      {/* Citizen */}
      <Route
        path="/complaints/new"
        element={
          <Shell>
            <NewComplaint />
          </Shell>
        }
      />
      <Route
        path="/departments"
        element={
          <Shell>
            <Departments />
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

      {/* Field worker */}
      <Route
        path="/jobs/done"
        element={
          <Shell minRank="FIELD_WORKER">
            <WorkerJobs scope="done" />
          </Shell>
        }
      />
      {/* A worker following a notification deep-link lands on their job list. */}
      <Route path="/jobs/:id" element={<Navigate to="/" replace />} />

      {/* Section Officer */}
      <Route
        path="/desk/inspect"
        element={
          <Shell minRank="SECTION_OFFICER">
            <OfficerDesk scope="awaiting" />
          </Shell>
        }
      />
      <Route
        path="/desk/done"
        element={
          <Shell minRank="SECTION_OFFICER">
            <OfficerDesk scope="done" />
          </Shell>
        }
      />
      <Route
        path="/map"
        element={
          <Shell minRank="SECTION_OFFICER">
            <ComplaintMap />
          </Shell>
        }
      />

      {/* Circle Officer and above */}
      <Route
        path="/complaints"
        element={
          <Shell minRank="CIRCLE_OFFICER">
            <AllComplaints />
          </Shell>
        }
      />
      <Route
        path="/escalations"
        element={
          <Shell minRank="CIRCLE_OFFICER">
            <Escalations />
          </Shell>
        }
      />
      <Route
        path="/risk"
        element={
          <Shell minRank="SECTION_OFFICER">
            <RiskQueue />
          </Shell>
        }
      />
      <Route
        path="/sectors"
        element={
          <Shell minRank="SECTION_OFFICER">
            <SectorRisk />
          </Shell>
        }
      />
      <Route
        path="/org"
        element={
          <Shell minRank="CIRCLE_OFFICER">
            <OrgChart />
          </Shell>
        }
      />

      {/* Authority-wide */}
      <Route
        path="/people"
        element={
          <Shell minRank="CEO">
            <People />
          </Shell>
        }
      />
      <Route
        path="/audit"
        element={
          <Shell minRank="CEO">
            <AuditTrail />
          </Shell>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
