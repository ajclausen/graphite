/**
 * SQLite's CURRENT_TIMESTAMP yields "YYYY-MM-DD HH:MM:SS" in UTC with no zone
 * marker, which Date() would otherwise parse as local time.
 */
export function parseTimestamp(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value: string): string {
  return parseTimestamp(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const relativeFormatter = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
  ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  : null;

/** "just now", "5 minutes ago", "yesterday"; falls back to a date after a week. */
export function formatRelative(value: string, now = Date.now()): string {
  const date = parseTimestamp(value);
  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSeconds);

  if (!relativeFormatter || abs >= 7 * 86400) return formatDate(value);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), 'minute');
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), 'hour');
  return relativeFormatter.format(Math.round(diffSeconds / 86400), 'day');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Compact form for tight spaces: "just now", "12m ago", "3h ago", "5d ago", then a date. */
export function formatRelativeShort(value: string, now = Date.now()): string {
  const date = parseTimestamp(value);
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Two-letter avatar initials from a display name or the email's local part. */
export function getInitials(user: { displayName?: string | null; email?: string } | null): string {
  const source = user?.displayName?.trim() || user?.email?.split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return initials.toUpperCase();
}
