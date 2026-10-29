import { useTheme } from './theme';

/** Whether the chosen theme is Dark Violet; follows the switch while the page is open (the diagrams re-render on it). */
export function useDarkMode(): boolean {
  return useTheme()[0] === 'dark';
}
