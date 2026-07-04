import React, { useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Asterisk } from 'lucide-react';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════
   InputField — ช่องกรอกข้อมูลพร้อมอนิเมชัน
   - focus glow (animate-border-glow บน wrapper)
   - label พร้อม required indicator
   - error state: ขอบแดง + shake animation
   - รองรับทั้ง input และ textarea
   ══════════════════════════════════════════════════════════ */

export interface InputFieldProps
  extends InputHTMLAttributes<HTMLInputElement> {
  /** ข้อความ label */
  label: string;
  /** ID สำหรับ input (ถ้าไม่ระบุ → auto-generate จาก label) */
  id?: string;
  /** ข้อความ error (ถ้ามี → แสดง error state) */
  error?: string;
  /** จำเป็นต้องกรอกหรือไม่ (แสดงดอกจัน) */
  required?: boolean;
  /** ให้แสดงผลเป็น textarea แทน input */
  multiline?: boolean;
  /** props สำหรับ textarea (ใช้ร่วมกับ multiline) */
  textareaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
  /** className สำหรับ wrapper */
  wrapperClassName?: string;
}

export function InputField({
  label,
  error,
  required = false,
  multiline = false,
  textareaProps,
  wrapperClassName = '',
  className = '',
  id,
  ...inputProps
}: InputFieldProps) {
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const [shakeTrigger, setShakeTrigger] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Generate stable ID
  const fieldId = id ?? `input-${label.replace(/\s+/g, '-').toLowerCase()}`;

  // ── Trigger shake when error appears ──────────────
  const prevErrorRef = useRef<string | undefined>(error);
  React.useEffect(() => {
    if (!reduced && error && error !== prevErrorRef.current) {
      setShakeTrigger(true);
      const timer = setTimeout(() => setShakeTrigger(false), 300);
      prevErrorRef.current = error;
      return () => clearTimeout(timer);
    }
    prevErrorRef.current = error;
  }, [error, reduced]);

  const baseInputClasses =
    'w-full px-4 py-2.5 rounded-lg border text-sm ' +
    'bg-white placeholder-gray-400 ' +
    'outline-none transition-all duration-200 ' +
    'focus:border-[#C00000] focus:ring-0 ' +
    'disabled:bg-gray-100 disabled:cursor-not-allowed ' +
    'font-thai';

  const inputClasses = [
    baseInputClasses,
    error
      ? 'border-red-400 pr-10'
      : 'border-gray-300',
    shakeTrigger ? 'animate-shake' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const wrapperAnimation = focused && !reduced ? 'animate-border-glow' : '';

  return (
    <div
      className={`flex flex-col gap-1.5 ${wrapperClassName} ${wrapperAnimation}`}
    >
      {/* ── Label ──────────────────────────────────── */}
      <label
        htmlFor={fieldId}
        className="flex items-center gap-1 text-sm font-medium text-gray-700"
      >
        {label}
        {required && (
          <Asterisk className="w-3 h-3 text-[#C00000]" aria-hidden="true" />
        )}
        {required && <span className="sr-only">จำเป็นต้องกรอก</span>}
      </label>

      {/* ── Input / Textarea ───────────────────────── */}
      {multiline ? (
        <div className="relative">
          <textarea
            ref={textareaRef}
            id={fieldId}
            className={inputClasses}
            rows={textareaProps?.rows ?? 4}
            onFocus={(e) => {
              setFocused(true);
              textareaProps?.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              textareaProps?.onBlur?.(e);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            aria-required={required}
            {...textareaProps}
          />
          {error && (
            <AlertCircle
              className="absolute right-3 top-3 w-4 h-4 text-red-400"
              aria-hidden="true"
            />
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            id={fieldId}
            className={inputClasses}
            onFocus={(e) => {
              setFocused(true);
              inputProps.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              inputProps.onBlur?.(e);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : undefined}
            aria-required={required}
            {...inputProps}
          />
          {error && (
            <AlertCircle
              className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-400"
              aria-hidden="true"
            />
          )}
        </div>
      )}

      {/* ── Error message ──────────────────────────── */}
      {error && (
        <p
          id={`${fieldId}-error`}
          role="alert"
          className="flex items-center gap-1 text-xs text-red-500 mt-0.5"
        >
          <AlertCircle className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
