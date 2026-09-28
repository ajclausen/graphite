import { useState } from 'react';
import { getCurrentTheme, toggleTheme } from '../utils/theme';
import { Icon } from './ui/Icon';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState(getCurrentTheme());
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      className={`g-icon-btn ${className}`}
      onClick={() => setTheme(toggleTheme())}
      title={label}
      aria-label={label}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
