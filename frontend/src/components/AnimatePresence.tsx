import React, { type ReactNode } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════
   AnimatePresence — CSS-based animation wrappers (no framer-motion)
   ใช้ animation utility classes จาก index.css
   ══════════════════════════════════════════════════════════ */

// ── Props ────────────────────────────────────────────────
export interface AnimateProps {
  /** แสดง / ซ่อน element */
  show?: boolean;
  children: ReactNode;
  /** className เพิ่มเติม */
  className?: string;
  /** ดีเลย์เป็นมิลลิวินาที (ใช้ inline style) */
  delay?: number;
  /** ลำดับ stagger (1-10) → ใช้ stagger-N class */
  staggerIndex?: number;
}

export interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  /** ระยะ stagger ต่อ child (default 50ms → stagger-1..10) */
  staggerBase?: number;
}

// ── Helpers ──────────────────────────────────────────────
function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

function animClass(
  baseClass: string,
  show: boolean,
  staggerIndex?: number,
): string {
  if (!show) return '';
  const parts = [baseClass];
  if (staggerIndex !== undefined && staggerIndex >= 1 && staggerIndex <= 10) {
    parts.push(`stagger-${staggerIndex}`);
  }
  return parts.join(' ');
}

// ── FadeIn ───────────────────────────────────────────────
/** จางเข้า (opacity 0→1) */
export function FadeIn({
  show = true,
  children,
  className,
  delay,
}: AnimateProps) {
  const reduced = useReducedMotion();

  if (!show) return null;

  return (
    <div
      className={cn(
        reduced ? '' : 'animate-fade-in',
        className,
      )}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}

// ── FadeUp ───────────────────────────────────────────────
/** จาง + เลื่อนขึ้น (fadeInUp) */
export function FadeUp({
  show = true,
  children,
  className,
  delay,
  staggerIndex,
}: AnimateProps) {
  const reduced = useReducedMotion();

  if (!show) return null;

  return (
    <div
      className={cn(
        reduced ? '' : animClass('animate-fade-in-up', show, staggerIndex),
        className,
      )}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}

// ── FadeLeft ─────────────────────────────────────────────
/** จาง + เลื่อนจากซ้าย */
export function FadeLeft({
  show = true,
  children,
  className,
  delay,
}: AnimateProps) {
  const reduced = useReducedMotion();

  if (!show) return null;

  return (
    <div
      className={cn(reduced ? '' : 'animate-fade-in-left', className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}

// ── FadeRight ────────────────────────────────────────────
/** จาง + เลื่อนจากขวา */
export function FadeRight({
  show = true,
  children,
  className,
  delay,
}: AnimateProps) {
  const reduced = useReducedMotion();

  if (!show) return null;

  return (
    <div
      className={cn(reduced ? '' : 'animate-fade-in-right', className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}

// ── ScaleIn ──────────────────────────────────────────────
/** ขยายเข้า (scale 0.94→1) — สำหรับ Modal/Dialog */
export function ScaleIn({
  show = true,
  children,
  className,
  delay,
}: AnimateProps) {
  const reduced = useReducedMotion();

  if (!show) return null;

  return (
    <div
      className={cn(reduced ? '' : 'animate-scale-in', className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}

// ── SlideInRight ─────────────────────────────────────────
/** เลื่อนเข้ามาจากขวา — สำหรับ workspace drawer */
export function SlideInRight({
  show = true,
  children,
  className,
  delay,
}: AnimateProps) {
  const reduced = useReducedMotion();

  if (!show) return null;

  return (
    <div
      className={cn(reduced ? '' : 'animate-slide-in-right', className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
      aria-hidden={!show}
    >
      {children}
    </div>
  );
}

// ── StaggerContainer ─────────────────────────────────────
/**
 * Container ที่ทำ stagger animation ให้ children แต่ละตัว
 * โดย children แต่ละตัวจะได้รับ stagger-N class ตามลำดับ (ผ่าน CSS variable)
 *
 * วิธีใช้:
 * <StaggerContainer>
 *   <FadeUp staggerIndex={1}>รายการที่ 1</FadeUp>
 *   <FadeUp staggerIndex={2}>รายการที่ 2</FadeUp>
 *   <FadeUp staggerIndex={3}>รายการที่ 3</FadeUp>
 * </StaggerContainer>
 */
export function StaggerContainer({
  children,
  className,
}: StaggerContainerProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={cn('stagger-container', className)}>
      {children}
    </div>
  );
}
