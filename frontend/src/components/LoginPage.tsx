import { useState, type FormEvent } from 'react'
import { Shield, User, Key, AlertCircle, Loader2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username.trim() || !password.trim()) {
      setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
      return
    }

    setLoading(true)
    try {
      await login(username, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเข้าระบบ')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid grid-cols-[3fr_2fr] h-screen">
      {/* ═══════════════════════════════════════════════════════
          Brand Area (Left 60%) — Dark navy, institutional
          ═══════════════════════════════════════════════════════ */}
      <div className="bg-[#1A1A2E] flex items-center justify-center">
        <div className="text-center px-8 max-w-md">
          {/* NBTC Shield */}
          <div className="inline-flex items-center justify-center mb-8">
            <Shield className="w-20 h-20 text-white" strokeWidth={1.5} />
          </div>

          {/* PAFC Branding */}
          <h1 className="text-5xl font-bold text-white mb-3 tracking-tight">
            PAFC
          </h1>
          <p className="text-base text-white/65 mb-10">
            Private Automated Frequency Coordinator
          </p>

          {/* Divider */}
          <div className="w-16 h-px bg-white/15 mx-auto mb-10" />

          {/* Thai Description */}
          <p className="text-base text-white/45 leading-relaxed">
            ระบบบริหารจัดการคลื่นความถี่
            <br />
            4800-4990 MHz
          </p>

          {/* NBTC Footer */}
          <p className="text-xs text-white/25 mt-16 leading-relaxed">
            สำนักงานคณะกรรมการกิจการกระจายเสียง
            <br />
            กิจการโทรทัศน์ และกิจการโทรคมนาคมแห่งชาติ
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          Form Area (Right 40%) — Warm off-white, centered card
          ═══════════════════════════════════════════════════════ */}
      <div className="bg-[#F5F5F0] flex items-center justify-center p-6">
        <div className="w-full max-w-[380px]">
          {/* Form Card */}
          <div className="bg-white rounded-lg p-8 shadow-sm">
            {/* Heading */}
            <h2 className="text-2xl font-bold text-[#1A1A2E] mb-6">
              เข้าสู่ระบบ
            </h2>

            {/* Error Message */}
            {error && (
              <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-[#BA1A1A] shrink-0 mt-0.5" />
                <span className="text-sm text-[#BA1A1A]">{error}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username */}
              <div>
                <label
                  htmlFor="username"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  ชื่อผู้ใช้
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <User className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="กรอกชื่อผู้ใช้"
                    className="w-full border border-[#CCC] rounded-md pl-9 pr-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none transition-all"
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-gray-700 mb-1.5"
                >
                  รหัสผ่าน
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Key className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="กรอกรหัสผ่าน"
                    className="w-full border border-[#CCC] rounded-md pl-9 pr-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none transition-all"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {/* Submit Button — solid #C00000, no gradient, hover #8B0000 */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#C00000] text-white rounded-lg py-2.5 font-medium text-sm hover:bg-[#8B0000] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
