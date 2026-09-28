import React, { useEffect, useRef, useState } from 'react';
import type { UserInfo } from '../api/client';
import { navigate } from '../utils/router';
import { ThemeToggle } from './ThemeToggle';
import { ChangePasswordModal } from './ChangePasswordModal';
import './ui/ui.css';

interface AppHeaderProps {
  user: UserInfo | null;
  current: 'library' | 'admin';
  onLogout: () => void;
}

function getInitials(user: UserInfo | null): string {
  const source = user?.displayName?.trim() || user?.email?.split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const initials = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return initials.toUpperCase();
}

const AccountMenu: React.FC<{ user: UserInfo | null; current: AppHeaderProps['current']; onLogout: () => void }> = ({
  user,
  current,
  onLogout,
}) => {
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Account';

  return (
    <div className="account-menu" ref={containerRef}>
      <button
        ref={triggerRef}
        className={`account-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span className="account-avatar" aria-hidden="true">{getInitials(user)}</span>
        <span className="account-trigger-name">{displayName}</span>
        <svg className="account-trigger-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="g-menu" role="menu">
          <div className="g-menu-header">
            <div className="g-menu-header-name">{displayName}</div>
            <div className="g-menu-header-sub">
              {user?.email}
              {user?.role === 'admin' ? ' · Admin' : ''}
            </div>
          </div>
          <div className="g-menu-divider" />
          {current !== 'library' && (
            <button className="g-menu-item" role="menuitem" onClick={choose(() => navigate({ name: 'library' }))}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Documents
            </button>
          )}
          {user?.role === 'admin' && current !== 'admin' && (
            <button className="g-menu-item" role="menuitem" onClick={choose(() => navigate({ name: 'admin' }))}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Manage users
            </button>
          )}
          <button className="g-menu-item" role="menuitem" onClick={choose(() => setChangingPassword(true))}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Change password
          </button>
          <div className="g-menu-divider" />
          <button className="g-menu-item g-menu-item--danger" role="menuitem" onClick={choose(onLogout)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      )}

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
};

export const AppHeader: React.FC<AppHeaderProps> = ({ user, current, onLogout }) => (
  <header className="app-header">
    <a className="app-brand" href="#/" aria-label="Graphite home">
      <img className="app-brand-mark" src="/logo.png" alt="" />
      <div className="app-brand-text">
        <h1>Graphite</h1>
        <p className="app-tagline">annotate &middot; sketch &middot; export</p>
      </div>
    </a>
    <div className="app-header-actions">
      <ThemeToggle />
      <AccountMenu user={user} current={current} onLogout={onLogout} />
    </div>
  </header>
);
