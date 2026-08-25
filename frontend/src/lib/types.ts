// Mirrors the backend enums in app/models/enums.py. Keep the two in step.
export type UserRole = 'citizen' | 'field_official' | 'admin'

export type ComplaintStatus =
  | 'submitted'
  | 'routed'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'closed'
  | 'rejected'
  | 'duplicate'

export type RiskBand = 'low' | 'moderate' | 'high' | 'severe'

export interface User {
  id: number
  email: string
  full_name: string
  phone: string | null
  role: UserRole
  is_active: boolean
  ward_id: number | null
  department_id: number | null
  created_at: string
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  user: User
}

export interface Ward {
  id: number
  ward_number: number
  name: string
  zone: string | null
  population: number | null
  centroid_lat: number | null
  centroid_lon: number | null
}

export interface Department {
  id: number
  code: string
  name: string
  description: string | null
}

/** One line of a GRIE explanation. Never render a score without these. */
export interface RiskFactor {
  factor: string
  label: string
  raw: number
  normalised: number
  weight: number
  contribution: number
  explanation: string
}
