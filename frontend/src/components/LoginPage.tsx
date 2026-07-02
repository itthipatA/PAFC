import { useState, type FormEvent } from 'react'
import { LogIn, Shield, User, Key } from 'lucide-react'
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
    <div className="min-h-screen flex relative bg-[#F5F5F0]">
      {/* Left Panel — Diagonal Split with full-bleed cover image (hidden on mobile) */}
      <div
        className="hidden lg:block relative w-[45%] min-h-screen overflow-hidden"
        style={{
          clipPath: 'polygon(0 0, 100% 0, 82% 100%, 0 100%)',
          filter: 'drop-shadow(3px 0 6px rgba(0,0,0,0.12))',
        }}
      >
        <img
          src="/Cover.png"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Subtle overlay gradient for depth */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, rgba(26,26,46,0.3) 0%, transparent 60%)',
          }}
        />
      </div>

      {/* Right Panel — Login Form */}
      <div className="flex-1 flex items-center justify-center bg-[#F5F5F0] px-4 sm:px-8 lg:px-12 min-h-screen">
        <div className="w-full max-w-[420px]">
          {/* Mobile-only branding */}
          <div className="lg:hidden text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-[#C00000] to-[#8B0000] rounded-xl mb-4 shadow-lg shadow-[#C00000]/25">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-lg font-bold text-[#1A1A2E] mb-1">
              Private Network AFC
            </h2>
            <p className="text-sm font-semibold text-[#C00000] mb-0.5">
              ระบบ PAFC
            </p>
            <p className="text-xs text-gray-400">4800-4990 MHz</p>
          </div>

          {/* Login Card */}
          <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 border border-gray-100 p-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-7 pb-5 border-b border-gray-100">
              <div className="w-11 h-11 bg-gradient-to-br from-[#C00000]/10 to-[#C00000]/5 rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-[#C00000]" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-[#1A1A2E] leading-tight">
                  เข้าสู่ระบบ
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  ระบบบริหารจัดการคลื่นความถี่
                </p>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2.5">
                <div className="w-5 h-5 bg-red-100 rounded-full flex items-center justify-center shrink-0 mt-px">
                  <svg
                    className="w-3 h-3 text-red-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Username */}
              <div>
                <label
                  htmlFor="username"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  ชื่อผู้ใช้
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <User className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    id="username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="กรอกชื่อผู้ใช้"
                    className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none transition-all bg-gray-50 hover:bg-white"
                    autoComplete="username"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-gray-700 mb-2"
                >
                  รหัสผ่าน
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Key className="w-4 h-4 text-gray-400" />
                  </div>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="กรอกรหัสผ่าน"
                    className="w-full border border-gray-300 rounded-xl pl-10 pr-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-[#C00000]/20 focus:border-[#C00000] outline-none transition-all bg-gray-50 hover:bg-white"
                    autoComplete="current-password"
                  />
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#C00000] to-[#D42020] hover:from-[#A00000] hover:to-[#B01010] text-white font-semibold py-3 rounded-xl text-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-[#C00000]/20 hover:shadow-xl hover:shadow-[#C00000]/30 hover:-translate-y-0.5 active:translate-y-0"
              >
                <LogIn className="w-4 h-4" />
                {loading ? (
                  <>
                    <svg
                      className="animate-spin w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    กำลังเข้าสู่ระบบ...
                  </>
                ) : (
                  'เข้าสู่ระบบ'
                )}
              </button>
            </form>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-gray-400 mt-6 leading-relaxed">
            สำนักงานคณะกรรมการกิจการกระจายเสียง
            <br className="sm:hidden" />
            กิจการโทรทัศน์ และกิจการโทรคมนาคมแห่งชาติ
          </p>
        </div>
      </div>
    </div>
  )
}
