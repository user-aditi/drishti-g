import { useAuth } from '../context/AuthContext'
import type { UserRole } from '../lib/types'

/** Placeholder panels, one per role.
 *
 * Phase 1 ends at auth and roles, so each panel states what will live here
 * rather than faking data. Real content lands with the complaints and risk
 * modules; the routing and role split around it is already real.
 */
const PANELS: Record<UserRole, { title: string; blurb: string; coming: string[] }> = {
  citizen: {
    title: 'Your complaints',
    blurb: 'File an issue and follow it from submission to resolution.',
    coming: [
      'File a complaint with a photo and location',
      'Track status and see every step GCCE took',
      'Leave feedback once it is resolved',
    ],
  },
  field_official: {
    title: 'Your task inbox',
    blurb: 'Work assigned to you by GCCE for your ward and department.',
    coming: [
      'See assigned complaints ordered by deadline',
      'Update progress and upload site evidence',
      'Flag a task that belongs to another department',
    ],
  },
  admin: {
    title: 'Supervisor dashboard',
    blurb: 'Oversight across wards, with GRIE surfacing what needs attention.',
    coming: [
      'The GRIE risk queue with per-factor reasoning',
      'Ward and department performance statistics',
      'Full audit trail with hash-chain verification',
    ],
  },
}

export default function Dashboard() {
  const { user } = useAuth()
  if (!user) return null

  const panel = PANELS[user.role]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{panel.title}</h1>
        <p className="mt-1 text-slate-600">{panel.blurb}</p>
      </div>

      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Phase 1
          </span>
          <span className="text-sm text-slate-500">
            Authentication and roles are live. Coming next:
          </span>
        </div>
        <ul className="space-y-2">
          {panel.coming.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-500" />
              {item}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Signed-in account
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd className="font-medium">{user.full_name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium break-all">{user.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Role</dt>
            <dd className="font-medium">{user.role}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Ward</dt>
            <dd className="font-medium">{user.ward_id ?? 'Not set'}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
