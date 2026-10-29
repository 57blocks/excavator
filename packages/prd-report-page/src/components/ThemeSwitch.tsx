import { THEME_LABELS, useTheme } from '../lib/theme';
import type { Theme } from '../lib/theme';

const THEMES: Theme[] = ['dark', 'light'];

/** A two-button segmented switch between Dark Violet and Light Violet. */
export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="seg theme-switch" role="group" aria-label="Theme">
      {THEMES.map((value) => (
        <button key={value} type="button" aria-pressed={theme === value} data-theme-option={value} onClick={() => setTheme(value)}>
          {THEME_LABELS[value]}
        </button>
      ))}
    </div>
  );
}
