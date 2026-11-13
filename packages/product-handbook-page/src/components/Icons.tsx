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

export const SearchIcon = () => (
  <svg {...base} width={16} height={16} strokeWidth={2}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
);

export const InfoIcon = () => (
  <svg {...base} width={14} height={14}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
);

export const ExpandIcon = () => (
  <svg {...base} width={16} height={16}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
);

export const ChevronIcon = () => (
  <svg {...base} width={16} height={16}><path d="M9 6l6 6-6 6" /></svg>
);
