import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import type { User } from '../types'

interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: 'เกิดข้อผิดพลาดในการเข้าระบบ' }))
      throw new Error(detail.detail || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    }

    const data = await res.json()
    setToken(data.access_token)
    setUser({ username: data.username, role: data.role })
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const fetchWithAuth = useCallback(
    async (url: string, options?: RequestInit): Promise<Response> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options?.headers as Record<string, string>) || {}),
      }

      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      return fetch(url, {
        ...options,
        headers,
      })
    },
    [token],
  )

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: token !== null && user !== null,
        login,
        logout,
        fetchWithAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
