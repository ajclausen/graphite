import React, { useState } from 'react';
import type { UserInfo } from '../api/client';
import { navigate } from '../utils/router';
import { getInitials } from '../utils/format';
import { ThemeToggle } from './ThemeToggle';
import { ChangePasswordModal } from './ChangePasswordModal';
import { Menu, type MenuItemDef } from './ui/Menu';
import { Icon } from './ui/Icon';
import './ui/ui.css';

interface AppHeaderProps {
  user: UserInfo | null;
  current: 'library' | 'admin';
  onLogout: () => void;
}

export const BrandMark: React.FC<{ compact?: boolean }> = ({ compact }) => (
  <span className="brand">
    <img className="brand-logo" src="/logo.png" alt="" width={28} height={28} />
    {!compact && <span className="brand-name">Graphite</span>}
  </span>
);

/** Moves keyboard focus past the header to the page's main region. */
export const SkipLink: React.FC<{ targetId?: string }> = ({ targetId = 'main' }) => (
  <button
    type="button"
    className="skip-link"
    onClick={() => document.getElementById(targetId)?.focus()}
  >
    Skip to content
  </button>
);

export const AppHeader: React.FC<AppHeaderProps> = ({ user, current, onLogout }) => {
  const [changingPassword, setChangingPassword] = useState(false);
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Account';

  const items: MenuItemDef[] = [
    ...(current !== 'library'
      ? [{ id: 'docs', label: 'Documents', icon: 'file' as const, onSelect: () => navigate({ name: 'library' }) }]
      : []),
    ...(user?.role === 'admin' && current !== 'admin'
      ? [{ id: 'users', label: 'Manage users', icon: 'users' as const, onSelect: () => navigate({ name: 'admin' }) }]
      : []),
    { id: 'password', label: 'Change password', icon: 'lock', onSelect: () => setChangingPassword(true) },
    { id: 'logout', label: 'Sign out', icon: 'logout', onSelect: onLogout, danger: true, separatorBefore: true },
  ];

  return (
    <header className="app-header">
      <SkipLink />
      <a className="app-header-brand" href="#/" aria-label="Graphite, go to documents">
        <BrandMark />
      </a>

      <nav className="app-header-nav" aria-label="Primary">
        <a className="app-nav-link" href="#/" aria-current={current === 'library' ? 'page' : undefined}>
          Documents
        </a>
        {user?.role === 'admin' && (
          <a className="app-nav-link" href="#/admin" aria-current={current === 'admin' ? 'page' : undefined}>
            Users
          </a>
        )}
      </nav>

      <div className="app-header-actions">
        <ThemeToggle />
        <Menu
          items={items}
          header={{ title: displayName, subtitle: `${user?.email ?? ''}${user?.role === 'admin' ? ' · Admin' : ''}` }}
          renderTrigger={(props, open) => (
            <button {...props} className={`account-trigger${open ? ' is-open' : ''}`} aria-label={`Account: ${displayName}`}>
              <span className="g-avatar" aria-hidden="true">{getInitials(user)}</span>
              <span className="account-trigger-name">{displayName}</span>
              <Icon name="chevronDown" size={14} className="account-trigger-chevron" />
            </button>
          )}
        />
      </div>

      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </header>
  );
};
