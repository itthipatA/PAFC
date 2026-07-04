import React from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════
   Skeleton — ตัวแสดงการโหลดแบบ shimmer
   Variants: line, block, card, circle
   ใช้ animate-shimmer จาก index.css
   ══════════════════════════════════════════════════════════ */

export type SkeletonVariant = 'line' | 'block' | 'card' | 'circle';

export interface SkeletonProps {
  /** รูปแบบ skeleton */
  variant?: SkeletonVariant;
  /** ความกว้าง (Tailwind class หรือ inline style) */
  width?: string;
  /** ความสูง (Tailwind class หรือ inline style) */
  height?: string;
  /** className เพิ่มเติม */
  className?: string;
}

const SHIMMER_BASE =
  'relative overflow-hidden rounded bg-gray-200 ' +
  'before:absolute before:inset-0 before:translate-x-[-100%] ' +
  'before:bg-gradient-to-r before:from-transparent ' +
  'before:via-white/40 before:to-transparent ' +
  'before:animate-shimmer';

// ── Variant defaults ──────────────────────────────────
const VARIANT_DEFAULTS: Record<
  SkeletonVariant,
  { width?: string; height?: string; rounded?: string }
> = {
  line: {
    width: 'w-full',
    height: 'h-4',
    rounded: 'rounded',
  },
  block: {
    width: 'w-full',
    height: 'h-32',
    rounded: 'rounded-lg',
  },
  card: {
    width: 'w-full',
    height: 'h-48',
    rounded: 'rounded-xl',
  },
  circle: {
    width: 'w-12',
    height: 'h-12',
    rounded: 'rounded-full',
  },
};

export function Skeleton({
  variant = 'line',
  width,
  height,
  className = '',
}: SkeletonProps) {
  const reduced = useReducedMotion();
  const defaults = VARIANT_DEFAULTS[variant];

  const w = width ?? defaults.width ?? 'w-full';
  const h = height ?? defaults.height ?? 'h-4';
  const r = variant === 'circle' ? 'rounded-full' : (defaults.rounded ?? 'rounded');

  // ถ้า reduced motion → แสดงแค่พื้นเทา ไม่มี shimmer
  const shimmerClass = reduced
    ? 'bg-gray-200'
    : SHIMMER_BASE;

  return (
    <div
      className={`${shimmerClass} ${w} ${h} ${r} ${className}`}
      role="status"
      aria-label="กำลังโหลด..."
      aria-busy="true"
    >
      <span className="sr-only">กำลังโหลด...</span>
    </div>
  );
}

// ── Preset helpers ─────────────────────────────────────

/** Skeleton แบบข้อความ (line variant) */
export function SkeletonLine(props: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="line" {...props} />;
}

/** Skeleton แบบบล็อกสี่เหลี่ยม (block variant) */
export function SkeletonBlock(props: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="block" {...props} />;
}

/** Skeleton แบบการ์ดเต็ม (card variant) */
export function SkeletonCard(props: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="card" {...props} />;
}

/** Skeleton แบบวงกลม — สำหรับ avatar */
export function SkeletonCircle(props: Omit<SkeletonProps, 'variant'>) {
  return <Skeleton variant="circle" {...props} />;
}
