import { useEffect, useState } from 'react';

const STORAGE_KEY = 'graphite-theme';
export type Theme = 'light' | 'dark';

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // First visit: follow the OS preference.
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#17171a' : '#fbfaf8');
  }
}

export function getCurrentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme) || 'dark';
}

export function toggleTheme(): Theme {
  const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function initTheme(): void {
  applyTheme(getStoredTheme());
}

/** Current app theme, kept in sync with toggles made anywhere in the app. */
export function useAppTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(getCurrentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getCurrentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
