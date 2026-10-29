/** Inline icons (design D7: no icon dependency). They are decorative: the button that holds one carries the name. */
const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export const MenuIcon = () => <svg {...base}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></svg>;
export const SearchIcon = () => <svg {...base}><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25 13.5 13.5" /></svg>;
export const ChevronIcon = () => <svg {...base}><path d="M6 3.5 10.5 8 6 12.5" /></svg>;
