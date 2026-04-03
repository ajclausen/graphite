import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  type UserInfo,
  listUsers,
  createUser,
  deleteUser,
  updateUser,
  resetUserPassword,
  changePassword as apiChangePassword,
} from '../api/client';
import { useAuthStore } from '../store/authStore';
import './AuthPages.css';

interface AdminPageProps {
  onBack: () => void;
}

export const AdminPage: React.FC<AdminPageProps> = ({ onBack }) => {
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
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [changePwError, setChangePwError] = useState('');
  const [changePwSuccess, setChangePwSuccess] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

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
    if (!confirm(`Delete user "${user.email}"? This cannot be undone.`)) return;
    try {
      await deleteUser(user.id);
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const handleToggleRole = async (user: UserInfo) => {
    setMenuUserId(null);
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await updateUser(user.id, { role: newRole });
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user role');
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
      setResetUserId(null);
      setResetPasswordValue('');
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setResetting(false);
    }
  };

  const handleChangeOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangePwError('');
    setChangePwSuccess(false);

    if (newPw !== confirmPw) {
      setChangePwError('New passwords do not match');
      return;
    }
    if (newPw.length < 8) {
      setChangePwError('New password must be at least 8 characters');
      return;
    }

    setChangingPw(true);
    try {
      const { user } = await apiChangePassword(currentPw, newPw);
      useAuthStore.setState({ user });
      setChangePwSuccess(true);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err) {
      setChangePwError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPw(false);
    }
  };

  const closeChangePassword = () => {
    setMenuUserId(null);
    setShowChangePassword(false);
    setCurrentPw('');
    setNewPw('');
    setConfirmPw('');
    setChangePwError('');
    setChangePwSuccess(false);
  };

  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-card auth-card--wide">
          <p className="auth-description">Loading users...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-card auth-card--wide">
        <div className="admin-header">
          <div className="admin-header-left">
            <h2 className="auth-title">User management</h2>
            <button
              className="admin-info-btn"
              onClick={() => setShowRoleInfo(!showRoleInfo)}
              title="Role permissions info"
              aria-label="Role permissions info"
            >
              i
            </button>
          </div>
          <button className="auth-link" onClick={onBack}>
            Back to app
          </button>
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
                  <li>Delete user accounts</li>
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

        <div className="admin-toolbar">
          <button
            className="admin-toolbar-btn"
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? 'Cancel' : '+ Add user'}
          </button>
        </div>

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
              <button className="admin-toolbar-btn" type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </form>
        )}

        <div className="admin-table-wrapper">
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
                  <td>{user.email}</td>
                  <td>{user.displayName || '-'}</td>
                  <td>
                    <span className={`admin-role-badge admin-role-badge--${user.role}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
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

        {/* Change own password modal */}
        {showChangePassword && (
          <div
            className="auth-modal-backdrop"
            onClick={() => { if (!changingPw) closeChangePassword(); }}
          >
            <div className="auth-card" onClick={(e) => e.stopPropagation()}>
              <h2 className="auth-title">Change your password</h2>
              <form className="auth-form" onSubmit={handleChangeOwnPassword}>
                {changePwError && <div className="auth-error">{changePwError}</div>}
                {changePwSuccess && <div className="auth-success">Password changed successfully.</div>}
                <label className="auth-label">
                  Current password
                  <input
                    className="auth-input"
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    placeholder="Enter current password"
                    required
                    autoFocus
                    autoComplete="current-password"
                  />
                </label>
                <label className="auth-label">
                  New password
                  <input
                    className="auth-input"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </label>
                <label className="auth-label">
                  Confirm new password
                  <input
                    className="auth-input"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    placeholder="Re-enter new password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </label>
                <div className="admin-modal-actions">
                  <button
                    type="button"
                    className="auth-link"
                    onClick={closeChangePassword}
                    disabled={changingPw}
                  >
                    Cancel
                  </button>
                  <button className="admin-toolbar-btn" type="submit" disabled={changingPw}>
                    {changingPw ? 'Changing...' : 'Change password'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
