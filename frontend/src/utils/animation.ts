/**
 * Animation utility functions for PAFC
 * Uses CSS custom properties (defined in index.css) for timing curves
 */

// ── Stagger delay ────────────────────────────────
export function staggerDelay(index: number, baseMs: number = 50): string {
  return `${index * baseMs}ms`;
}

// ── Sequential animation helper ──────────────────
export async function sequence(
  steps: Array<() => Promise<void> | void>,
  delayMs: number = 100
): Promise<void> {
  for (const step of steps) {
    await step();
    if (delayMs > 0) await sleep(delayMs);
  }
}

// ── Debounced callback ───────────────────────────
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Sleep (for async sequences) ──────────────────
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Generate unique animation ID ─────────────────
let animIdCounter = 0;
export function nextAnimId(): string {
  return `anim-${++animIdCounter}-${Date.now()}`;
}

// ── CSS class builder for animation ──────────────
export interface AnimOptions {
  duration?: number;
  delay?: number;
  curve?: string;
  fillMode?: 'none' | 'forwards' | 'backwards' | 'both';
}

export function animStyle(opts: AnimOptions = {}): React.CSSProperties {
  return {
    animationDuration: `${opts.duration ?? 400}ms`,
    animationDelay: `${opts.delay ?? 0}ms`,
    animationTimingFunction: opts.curve ?? 'var(--ease-expo)',
    animationFillMode: opts.fillMode ?? 'both',
  };
}

// ── Pulse effect trigger ─────────────────────────
export function triggerPulse(element: HTMLElement | null): void {
  if (!element) return;
  element.classList.remove('animate-pulse-ring');
  void element.offsetWidth; // force reflow
  element.classList.add('animate-pulse-ring');
}
