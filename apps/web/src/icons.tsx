/**
 * Icons, drawn rather than imported.
 *
 * No icon font and no sprite sheet: a handful of paths inline is smaller than
 * either, works offline, and inherits colour and weight from the text beside
 * it — which is what makes an icon look like part of the product rather than
 * something pasted on.
 *
 * Stroke-based and on a 24-grid, so they sit at the same optical weight as the
 * type. Every one is decorative: the label next to it is what gets announced.
 */

type Props = { size?: number; filled?: boolean };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
});

/** TODAY — a day with the current hour marked. */
export function IconToday({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="5" width="18" height="16" rx="3" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.12 : 1} />
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      {filled && <circle cx="12" cy="15.5" r="2.2" fill="currentColor" stroke="none" />}
    </svg>
  );
}

/** CLINIC — the chair, which is what a dental day is actually made of. */
export function IconClinic({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M7 4.5A1.5 1.5 0 0 1 8.5 3h1A1.5 1.5 0 0 1 11 4.5V12H7z" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.14 : 1} />
      <path d="M7 4.5A1.5 1.5 0 0 1 8.5 3h1A1.5 1.5 0 0 1 11 4.5V12H7z" />
      <path d="M4 12h13a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3H8a4 4 0 0 1-4-4z" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.14 : 1} />
      <path d="M4 12h13a3 3 0 0 1 3 3v1a3 3 0 0 1-3 3H8a4 4 0 0 1-4-4z" />
      <path d="M7 19v2M17 19v2" />
    </svg>
  );
}

/** ATTENTION — a bell, because it is the thing that comes and finds you. */
export function IconAttention({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 4.5-1.5 5.5-2 6.5h16c-.5-1-2-2-2-6.5z" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.14 : 1} />
      <path d="M18 8.5a6 6 0 1 0-12 0c0 4.5-1.5 5.5-2 6.5h16c-.5-1-2-2-2-6.5z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

/** CHECKS — a second pair of eyes over a list. */
export function IconChecks({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="4" y="3" width="16" height="18" rx="3" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.12 : 1} />
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M8.5 9.5l2 2 4-4M8.5 16h7" />
    </svg>
  );
}

/** ME. */
export function IconMe({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="8" r="3.6" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.14 : 1} />
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.14 : 1} />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

/** A tick, for anything already confirmed. */
export function IconTick({ size = 16 }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2.6}>
      <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />
    </svg>
  );
}

/** Forward chevron on a row. */
export function IconGo({ size = 18 }: Props) {
  return (
    <svg {...base(size)} strokeWidth={2}>
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/** Something needs looking at — used on warning notices, never decoratively. */
export function IconAlert({ size = 18 }: Props) {
  return (
    <svg {...base(size)} strokeWidth={1.9}>
      <path d="M12 3.5 1.8 20.5h20.4z" />
      <path d="M12 9.5v5M12 17.6v.01" />
    </svg>
  );
}

/** HANDOVER — a page passed on: what the next shift inherits. */
export function IconHandover({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M7 3.5h7.5L19 8v12.5H7z" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.12 : 1} />
      <path d="M7 3.5h7.5L19 8v12.5H7z" />
      <path d="M14.5 3.5V8H19" />
      <path d="M10 12.5h6M10 16h4" />
    </svg>
  );
}

/** OVERVIEW — bars, because that is what the screen is. */
export function IconOverview({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <rect x="3" y="4" width="18" height="16" rx="3" fill={filled ? 'currentColor' : 'none'} opacity={filled ? 0.12 : 1} />
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M8 16v-4M12 16V8.5M16 16v-2.5" />
    </svg>
  );
}

/**
 * QUALITY — a loop that closes.
 *
 * A circular arrow rather than a clipboard or a warning triangle: this tab is
 * not a list of problems, it is the stage where a problem goes round and comes
 * back changed. The gap in the ring is where the arrowhead lands, so the shape
 * reads as returning rather than as a plain circle.
 */
export function IconQuality({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 3.5V8h-4.5" />
      {filled && <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />}
    </svg>
  );
}

/**
 * PATIENTS — a person with a check beside them.
 *
 * Not a clipboard: this tab is about whether a person is ready, not about a
 * list of forms. The check sits to the side rather than over the figure, so it
 * reads as "about this person" rather than "this person is done".
 */
export function IconPatients({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <circle cx="9.5" cy="7.5" r="3.2" {...(filled ? { fill: 'currentColor' } : {})} />
      <path d="M3.5 19.5a6 6 0 0 1 12 0" />
      <path d="M16.5 12.8l1.6 1.6 3-3.2" />
    </svg>
  );
}

/**
 * OPERATIONS — a gauge.
 *
 * Not a wrench: this tab is about whether the clinic's plant, stock and
 * sterilisation are in a fit state, not about repairing things. A gauge reads
 * as "how is it doing", which is the question the screen answers.
 */
export function IconOperations({ size = 22, filled = false }: Props) {
  return (
    <svg {...base(size)}>
      <path d="M3.6 17.5a9 9 0 1 1 16.8 0" />
      <path d="M12 13.5l3.8-3.6" />
      {filled && <circle cx="12" cy="13.8" r="1.9" fill="currentColor" stroke="none" />}
    </svg>
  );
}
