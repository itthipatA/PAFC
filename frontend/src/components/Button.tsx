import React, { useRef, useCallback, type ButtonHTMLAttributes, type MouseEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════
   Button — ปุ่มแบบมีอนิเมชัน
   - press scale animation (animate-press)
   - ripple effect (rippleEffect keyframe)
   - pulse ring (animate-pulse-ring สำหรับ analyze)
   - variants: primary / secondary / danger
   - loading state (Loader2 icon + disabled)
   ══════════════════════════════════════════════════════════ */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** สไตล์ปุ่ม */
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** แสดงสถานะกำลังโหลด */
  loading?: boolean;
  /** แสดง pulse ring animation (สำหรับปุ่มวิเคราะห์/ดำเนินการ) */
  pulse?: boolean;
  /** ปิดการใช้งาน */
  disabled?: boolean;
}

const VARIANT_CLASSES: Record<'primary' | 'secondary' | 'danger' | 'ghost', string> = {
  primary:
    'bg-[#C00000] text-white hover:bg-[#A00000] active:bg-[#8B0000] ' +
    'shadow-md shadow-red-900/20 hover:shadow-lg hover:shadow-red-900/30 ' +
    'focus:ring-2 focus:ring-red-500/30 focus:ring-offset-2',
  secondary:
    'bg-white text-[#C00000] border-2 border-[#C00000] ' +
    'hover:bg-red-50 active:bg-red-100 ' +
    'focus:ring-2 focus:ring-red-500/20 focus:ring-offset-2',
  danger:
    'bg-[#DC2626] text-white hover:bg-[#B91C1C] active:bg-[#991B1B] ' +
    'shadow-md shadow-red-700/20 hover:shadow-lg hover:shadow-red-700/30 ' +
    'focus:ring-2 focus:ring-red-400/30 focus:ring-offset-2',
  ghost:
    'bg-transparent text-gray-600 hover:bg-gray-100 active:bg-gray-200 ' +
    'focus:ring-2 focus:ring-gray-400/20',
};

export function Button({
  variant = 'primary',
  loading = false,
  pulse = false,
  disabled,
  children,
  className = '',
  onClick,
  ...rest
}: ButtonProps) {
  const reduced = useReducedMotion();
  const btnRef = useRef<HTMLButtonElement>(null);
  const rippleContainerRef = useRef<HTMLSpanElement>(null);

  const isDisabled = disabled || loading;

  // ── Ripple effect on mousedown ──────────────────────
  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (reduced || isDisabled) return;

      const btn = btnRef.current;
      if (!btn) return;

      // Remove old ripple spans
      const existingRipples = btn.querySelectorAll('.ripple-effect');
      existingRipples.forEach((el) => el.remove());

      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top - size / 2;

      const ripple = document.createElement('span');
      ripple.className = 'ripple-effect';
      ripple.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        pointer-events: none;
        animation: rippleEffect 400ms var(--ease-expo) forwards;
      `;
      btn.appendChild(ripple);

      // Clean up after animation
      setTimeout(() => ripple.remove(), 400);
    },
    [reduced, isDisabled],
  );

  // ── Press animation (toggle class on mousedown/up) ──
  const handlePressDown = useCallback(() => {
    if (reduced || isDisabled) return;
    btnRef.current?.classList.add('animate-press');
  }, [reduced, isDisabled]);

  const handlePressUp = useCallback(() => {
    btnRef.current?.classList.remove('animate-press');
  }, []);

  const baseClasses =
    'relative overflow-hidden inline-flex items-center justify-center gap-2 ' +
    'px-5 py-2.5 rounded-lg font-medium text-sm ' +
    'transition-all duration-200 ease-out ' +
    'disabled:opacity-50 disabled:cursor-not-allowed ' +
    'select-none outline-none';

  return (
    <button
      ref={btnRef}
      disabled={isDisabled}
      className={`
        ${baseClasses}
        ${VARIANT_CLASSES[variant]}
        ${pulse && !reduced ? 'animate-pulse-ring' : ''}
        ${className}
      `}
      onMouseDown={(e) => {
        handleMouseDown(e);
        handlePressDown();
      }}
      onMouseUp={handlePressUp}
      onMouseLeave={handlePressUp}
      onClick={isDisabled ? undefined : onClick}
      aria-busy={loading}
      aria-disabled={isDisabled}
      {...rest}
    >
      {/* Ripple container (optional span for CSS-only ripple) */}
      <span ref={rippleContainerRef} className="absolute inset-0 pointer-events-none" />

      {loading && (
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      )}
      {children}
      {loading && <span className="sr-only">กำลังดำเนินการ...</span>}
    </button>
  );
}
