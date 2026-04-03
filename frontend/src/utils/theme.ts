const STORAGE_KEY = 'graphite-theme';
export type Theme = 'light' | 'dark';

export function getStoredTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#1B1D21' : '#F5F0E8');
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
