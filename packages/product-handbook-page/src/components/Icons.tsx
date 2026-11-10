/** Decorative icons: every one is hidden from assistive technology and carries no text. */

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export const MenuIcon = () => (
  <svg {...base}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
);

export const CloseIcon = () => (
  <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
);

export const CheckIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" /></svg>
);
