import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, tokenStore } from '../lib/api'
import type { Rank, User } from '../lib/types'

interface AuthState {
  user: User | null
  /**
   * True until the stored token has been checked against the server. Routes must
   * wait for this, or a refresh on a protected page bounces to /login before the
   * session is restored.
   */
  loading: boolean
  login: (email: string, password: string) => Promise<User>
  register: (payload: {
    email: string
    password: string
    fullName: string
    phone?: string
    homeSectorId?: number | null
  }) => Promise<User>
  logout: () => void
  hasRank: (...ranks: Rank[]) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (!tokenStore.access) {
        setLoading(false)
        return
      }
      try {
        const me = await api.me()
        if (!cancelled) setUser(me)
      } catch {
        tokenStore.clear()
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password)
    tokenStore.set(res.accessToken, res.refreshToken)
    setUser(res.user)
    return res.user
  }, [])

  const register = useCallback<AuthState['register']>(async (payload) => {
    const res = await api.register(payload)
    tokenStore.set(res.accessToken, res.refreshToken)
    setUser(res.user)
    return res.user
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  const hasRank = useCallback(
    (...ranks: Rank[]) => (user ? ranks.includes(user.rank) : false),
    [user],
  )

  const value = useMemo(
    () => ({ user, loading, login, register, logout, hasRank }),
    [user, loading, login, register, logout, hasRank],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider')
  return ctx
}
