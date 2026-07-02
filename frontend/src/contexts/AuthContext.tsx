import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { User } from '../types'

function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    let payload = parts[1]
    // Add padding
    while (payload.length % 4 !== 0) payload += '='
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

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

  // Restore auth from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('pafc_token')
    const savedUser = localStorage.getItem('pafc_user')
    if (savedToken) {
      const payload = decodeJwtPayload(savedToken)
      if (payload && payload.exp && payload.exp * 1000 > Date.now()) {
        setToken(savedToken)
        try {
          setUser(JSON.parse(savedUser || 'null'))
        } catch {
          localStorage.removeItem('pafc_token')
          localStorage.removeItem('pafc_user')
        }
      } else {
        localStorage.removeItem('pafc_token')
        localStorage.removeItem('pafc_user')
      }
    }
  }, [])

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
    localStorage.setItem('pafc_token', data.access_token)
    localStorage.setItem('pafc_user', JSON.stringify({ username: data.username, role: data.role }))
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('pafc_token')
    localStorage.removeItem('pafc_user')
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
