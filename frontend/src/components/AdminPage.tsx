import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  type UserInfo,
  listUsers,
  createUser,
  deleteUser,
  updateUser,
  resetUserPassword,
} from '../api/client';
import { useAuthStore } from '../store/authStore';
import { confirmDialog, toast, errorMessage } from '../store/uiStore';
import { ChangePasswordModal } from './ChangePasswordModal';
import './AuthPages.css';

export const AdminPage: React.FC = () => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showRoleInfo, setShowRoleInfo] = useState(false);
  const [menuUserId, setMenuUserId] = useState<string | null>(null);
  const currentUser = useAuthStore((s) => s.user);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset password form (for other users)
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPasswordValue] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  // Change own password modal
  const [showChangePassword, setShowChangePassword] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (!menuUserId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (actionMenuRef.current?.contains(target)) {
        return;
      }
      setMenuUserId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuUserId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuUserId]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');

    if (newPassword.length < 8) {
      setCreateError('Password must be at least 8 characters');
      return;
    }

    setCreating(true);
    try {
      await createUser(newEmail, newPassword, newDisplayName || undefined, newRole);
      toast.success(`Added ${newEmail}`, 'They’ll be asked to choose a new password when they first sign in.');
      setShowCreate(false);
      setNewEmail('');
      setNewPassword('');
      setNewDisplayName('');
      setNewRole('user');
      await loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (user: UserInfo) => {
    setMenuUserId(null);
    const confirmed = await confirmDialog({
      title: 'Delete this user?',
      message: `${user.email} will be signed out immediately, and all of their documents and annotations will be permanently deleted. This can’t be undone.`,
      confirmLabel: 'Delete user',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteUser(user.id);
      toast.success(`Deleted ${user.email}`, 'Their documents were removed too.');
      await loadUsers();
    } catch (err) {
      toast.error('Couldn’t delete user', errorMessage(err, 'Please try again.'));
    }
  };

  const handleToggleRole = async (user: UserInfo) => {
    setMenuUserId(null);
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await updateUser(user.id, { role: newRole });
      toast.success(newRole === 'admin' ? `${user.email} is now an admin` : `${user.email} is now a regular user`);
      await loadUsers();
    } catch (err) {
      toast.error('Couldn’t change role', errorMessage(err, 'Please try again.'));
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserId) return;
    setResetError('');

    if (resetPassword.length < 8) {
      setResetError('Password must be at least 8 characters');
      return;
    }

    setResetting(true);
    try {
      await resetUserPassword(resetUserId, resetPassword);
      const email = users.find((u) => u.id === resetUserId)?.email;
      toast.success('Password reset', email ? `${email} will choose a new one at next sign-in.` : undefined);
      setResetUserId(null);
      setResetPasswordValue('');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="admin-page">
      <div className="admin-page-inner">
        <div className="admin-header">
          <div className="admin-header-left">
            <h2 className="admin-title">Users</h2>
            {!loading && <span className="admin-count">{users.length}</span>}
          </div>
          <div className="admin-header-right">
            <button
              className={`g-btn g-btn--ghost${showRoleInfo ? ' is-active' : ''}`}
              onClick={() => setShowRoleInfo(!showRoleInfo)}
              aria-expanded={showRoleInfo}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="11" x2="12" y2="16" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              Roles
            </button>
            <button
              className={`g-btn ${showCreate ? 'g-btn--secondary' : 'g-btn--primary'}`}
              onClick={() => setShowCreate(!showCreate)}
            >
              {showCreate ? 'Cancel' : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add user
                </>
              )}
            </button>
          </div>
        </div>

        {showRoleInfo && (
          <div className="admin-info-panel">
            <div className="admin-info-panel-header">
              <strong>Role permissions</strong>
              <button
                className="admin-info-close"
                onClick={() => setShowRoleInfo(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className="admin-info-columns">
              <div className="admin-info-column">
                <div className="admin-info-role-title">
                  <span className="admin-role-badge admin-role-badge--admin">Admin</span>
                </div>
                <ul className="admin-info-list">
                  <li>Upload, view, annotate, and export documents</li>
                  <li>Create and manage user accounts</li>
                  <li>Reset passwords for any user</li>
                  <li>Promote users to admin or demote admins</li>
                  <li>Delete user accounts (and their documents)</li>
                </ul>
              </div>
              <div className="admin-info-column">
                <div className="admin-info-role-title">
                  <span className="admin-role-badge admin-role-badge--user">User</span>
                </div>
                <ul className="admin-info-list">
                  <li>Upload, view, annotate, and export documents</li>
                  <li>Change their own password</li>
                  <li>Can only see their own documents</li>
                  <li>No access to user management</li>
                </ul>
              </div>
            </div>
            <p className="admin-info-note">
              New users are required to change their temporary password on first login.
            </p>
          </div>
        )}

        {error && <div className="auth-error">{error}</div>}

        {showCreate && (
          <form className="auth-form admin-create-form" onSubmit={handleCreateUser}>
            {createError && <div className="auth-error">{createError}</div>}
            <div className="admin-form-row">
              <input
                className="auth-input"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email"
                required
                autoFocus
              />
              <input
                className="auth-input"
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                placeholder="Display name"
              />
            </div>
            <div className="admin-form-row">
              <input
                className="auth-input"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Temp password (min 8 chars)"
                required
                minLength={8}
                autoComplete="new-password"
              />
              <select
                className="auth-input auth-select"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
              <button className="g-btn g-btn--primary" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create user'}
              </button>
            </div>
          </form>
        )}

        <div className="admin-table-wrapper">
          {loading ? (
            <div className="admin-loading"><div className="g-spinner" /></div>
          ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    {user.email}
                    {user.id === currentUser?.id && <span className="admin-you">you</span>}
                  </td>
                  <td>{user.displayName || <span className="admin-muted">—</span>}</td>
                  <td>
                    <span className={`admin-role-badge admin-role-badge--${user.role}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                  <td className="admin-actions-cell">
                    <div
                      className="admin-actions-menu"
                      ref={menuUserId === user.id ? actionMenuRef : null}
                    >
                      <button
                        className="admin-action-trigger"
                        onClick={() => setMenuUserId((prev) => (prev === user.id ? null : user.id))}
                        aria-haspopup="menu"
                        aria-expanded={menuUserId === user.id}
                        aria-label={`Open actions for ${user.email}`}
                      >
                        ⋯
                      </button>

                      {menuUserId === user.id && (
                        <div className="admin-action-popover" role="menu">
                          {user.id === currentUser?.id ? (
                            <button
                              className="admin-action-menu-item"
                              onClick={() => {
                                setMenuUserId(null);
                                setShowChangePassword(true);
                              }}
                            >
                              Change password
                            </button>
                          ) : (
                            <>
                              <button
                                className="admin-action-menu-item"
                                onClick={() => handleToggleRole(user)}
                                title={user.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                              >
                                {user.role === 'admin' ? 'Demote to user' : 'Promote to admin'}
                              </button>
                              <button
                                className="admin-action-menu-item"
                                onClick={() => {
                                  setMenuUserId(null);
                                  setResetUserId(user.id);
                                  setResetPasswordValue('');
                                  setResetError('');
                                }}
                              >
                                Reset password
                              </button>
                              <div className="admin-action-divider" />
                              <button
                                className="admin-action-menu-item admin-action-menu-item--danger"
                                onClick={() => handleDeleteUser(user)}
                              >
                                Delete user
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </div>

        {/* Reset password modal (for other users) */}
        {resetUserId && (
          <div
            className="auth-modal-backdrop"
            onClick={() => { if (!resetting) setResetUserId(null); }}
          >
            <div className="auth-card" onClick={(e) => e.stopPropagation()}>
              <h2 className="auth-title">Reset password</h2>
              <p className="auth-description">
                Set a new password for{' '}
                <strong>{users.find((u) => u.id === resetUserId)?.email}</strong>.
                The user will be required to change it on next login.
              </p>
              <form className="auth-form" onSubmit={handleResetPassword}>
                {resetError && <div className="auth-error">{resetError}</div>}
                <label className="auth-label">
                  New password
                  <input
                    className="auth-input"
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    autoFocus
                    autoComplete="new-password"
                  />
                </label>
                <div className="admin-modal-actions">
                  <button
                    type="button"
                    className="auth-link"
                    onClick={() => setResetUserId(null)}
                    disabled={resetting}
                  >
                    Cancel
                  </button>
                  <button className="admin-toolbar-btn" type="submit" disabled={resetting}>
                    {resetting ? 'Resetting...' : 'Reset password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
      </div>
    </div>
  );
};
