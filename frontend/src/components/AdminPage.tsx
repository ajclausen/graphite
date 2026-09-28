import React, { useState, useEffect, useCallback, useId } from 'react';
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
import { formatDate, getInitials } from '../utils/format';
import { PHONE_QUERY, useMediaQuery } from '../utils/useMediaQuery';
import { ChangePasswordModal } from './ChangePasswordModal';
import { Modal } from './ui/Modal';
import { Menu, type MenuItemDef } from './ui/Menu';
import { Icon } from './ui/Icon';
import { PasswordInput } from './ui/PasswordInput';
import './AdminPage.css';

/** Readable temporary password: no look-alike characters. */
function generateTempPassword(length = 14): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join('');
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Password copied');
  } catch {
    toast.error('Couldn’t copy', 'Select the password and copy it manually.');
  }
}

/** Temp-password field with "Generate" and "Copy", used by create and reset. */
const TempPasswordField: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}> = ({ id, value, onChange, disabled }) => {
  const hintId = useId();
  const tooShort = value.length > 0 && value.length < 8;
  return (
    <div className="g-field">
      <label className="g-label" htmlFor={id}>Temporary password</label>
      <div className="admin-password-row">
        <PasswordInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          disabled={disabled}
          aria-invalid={tooShort || undefined}
          aria-describedby={hintId}
        />
        <button type="button" className="g-btn g-btn--secondary" onClick={() => onChange(generateTempPassword())} disabled={disabled}>
          Generate
        </button>
        <button
          type="button"
          className="g-icon-btn"
          onClick={() => void copyToClipboard(value)}
          disabled={disabled || !value}
          aria-label="Copy password"
          title="Copy password"
        >
          <Icon name="copy" size={17} />
        </button>
      </div>
      <span id={hintId} className={`g-hint${tooShort ? ' is-error' : ''}`}>
        At least 8 characters. They’ll choose their own the first time they sign in.
      </span>
    </div>
  );
};

const RoleBadge: React.FC<{ role: UserInfo['role'] }> = ({ role }) => (
  <span className={`g-badge${role === 'admin' ? ' g-badge--accent' : ''}`}>{role === 'admin' ? 'Admin' : 'User'}</span>
);

export const AdminPage: React.FC = () => {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showRoleInfo, setShowRoleInfo] = useState(false);
  const currentUser = useAuthStore((s) => s.user);
  const isPhone = useMediaQuery(PHONE_QUERY);

  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [resetUser, setResetUser] = useState<UserInfo | null>(null);
  const [resetPassword, setResetPasswordValue] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  const [showChangePassword, setShowChangePassword] = useState(false);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(await listUsers());
      setLoadError('');
    } catch (err) {
      setLoadError(errorMessage(err, 'Couldn’t load users.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openCreate = () => {
    setNewEmail('');
    setNewDisplayName('');
    setNewRole('user');
    setNewPassword(generateTempPassword());
    setCreateError('');
    setShowCreate(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (newPassword.length < 8) {
      setCreateError('The temporary password needs at least 8 characters.');
      return;
    }
    setCreating(true);
    try {
      await createUser(newEmail.trim(), newPassword, newDisplayName.trim() || undefined, newRole);
      toast.success(`Added ${newEmail.trim()}`, 'Share the temporary password with them. They’ll replace it on first sign-in.');
      setShowCreate(false);
      await loadUsers();
    } catch (err) {
      setCreateError(errorMessage(err, 'Couldn’t create the user.'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteUser = async (user: UserInfo) => {
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
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await updateUser(user.id, { role: nextRole });
      toast.success(nextRole === 'admin' ? `${user.email} is now an admin` : `${user.email} is now a regular user`);
      await loadUsers();
    } catch (err) {
      toast.error('Couldn’t change role', errorMessage(err, 'Please try again.'));
    }
  };

  const openReset = (user: UserInfo) => {
    setResetUser(user);
    setResetPasswordValue(generateTempPassword());
    setResetError('');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUser) return;
    setResetError('');
    if (resetPassword.length < 8) {
      setResetError('The temporary password needs at least 8 characters.');
      return;
    }
    setResetting(true);
    try {
      await resetUserPassword(resetUser.id, resetPassword);
      toast.success('Password reset', `${resetUser.email} will choose a new one at next sign-in.`);
      setResetUser(null);
    } catch (err) {
      setResetError(errorMessage(err, 'Couldn’t reset the password.'));
    } finally {
      setResetting(false);
    }
  };

  const menuItemsFor = (user: UserInfo): MenuItemDef[] => (
    user.id === currentUser?.id
      ? [{ id: 'pw', label: 'Change your password', icon: 'lock', onSelect: () => setShowChangePassword(true) }]
      : [
        {
          id: 'role',
          label: user.role === 'admin' ? 'Make regular user' : 'Make admin',
          icon: 'users',
          onSelect: () => void handleToggleRole(user),
        },
        { id: 'reset', label: 'Reset password', icon: 'lock', onSelect: () => openReset(user) },
        { id: 'delete', label: 'Delete user', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => void handleDeleteUser(user) },
      ]
  );

  const renderActions = (user: UserInfo) => (
    <Menu
      items={menuItemsFor(user)}
      header={isPhone ? { title: user.displayName || user.email, subtitle: user.email } : undefined}
      renderTrigger={(props) => (
        <button {...props} className="g-icon-btn" aria-label={`Actions for ${user.email}`}>
          <Icon name="moreHorizontal" size={18} />
        </button>
      )}
    />
  );

  const renderIdentity = (user: UserInfo) => (
    <div className="admin-user">
      <span className="g-avatar" aria-hidden="true">{getInitials(user)}</span>
      <div className="admin-user-text">
        <span className="admin-user-name">
          {user.displayName || user.email.split('@')[0]}
          {user.id === currentUser?.id && <span className="admin-you">(you)</span>}
        </span>
        <span className="admin-user-email">{user.email}</span>
      </div>
    </div>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            Users
            {!loading && <span className="g-badge" aria-label={`${users.length} users`}>{users.length}</span>}
          </h1>
          <p className="page-subtitle">Everyone who can sign in to this Graphite server.</p>
        </div>
        <div className="admin-header-actions">
          <button
            type="button"
            className={`g-btn g-btn--ghost${showRoleInfo ? ' is-active' : ''}`}
            onClick={() => setShowRoleInfo(!showRoleInfo)}
            aria-expanded={showRoleInfo}
            aria-controls="role-info"
          >
            <Icon name="info" size={16} />
            About roles
          </button>
          <button type="button" className="g-btn g-btn--primary" onClick={openCreate}>
            <Icon name="plus" size={16} strokeWidth={2.5} />
            Add user
          </button>
        </div>
      </div>

      {showRoleInfo && (
        <section id="role-info" className="admin-roles" aria-label="Role permissions">
          <div className="admin-role-card">
            <h2><RoleBadge role="admin" /></h2>
            <ul>
              <li>Everything a user can do</li>
              <li>Add users and reset their passwords</li>
              <li>Promote or demote admins</li>
              <li>Delete users, along with their documents</li>
            </ul>
          </div>
          <div className="admin-role-card">
            <h2><RoleBadge role="user" /></h2>
            <ul>
              <li>Upload, annotate and export documents</li>
              <li>Sees only their own documents</li>
              <li>Changes their own password</li>
            </ul>
          </div>
        </section>
      )}

      {loadError && (
        <div className="g-alert" role="alert">
          <Icon name="alert" size={16} />
          <span>{loadError}</span>
        </div>
      )}

      {loading ? (
        <div className="admin-loading" role="status" aria-label="Loading users"><div className="g-spinner" /></div>
      ) : isPhone ? (
        <ul className="admin-cards" aria-label="Users">
          {users.map((user) => (
            <li key={user.id} className="admin-card">
              {renderIdentity(user)}
              <div className="admin-card-meta">
                <RoleBadge role={user.role} />
                <span>Joined {formatDate(user.createdAt)}</span>
              </div>
              <div className="admin-card-actions">{renderActions(user)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="visually-hidden">Users</caption>
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Joined</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{renderIdentity(user)}</td>
                  <td><RoleBadge role={user.role} /></td>
                  <td className="admin-muted">{formatDate(user.createdAt)}</td>
                  <td className="admin-actions-cell">{renderActions(user)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal title="Add user" description="They’ll sign in with this email and a temporary password." onClose={() => setShowCreate(false)} busy={creating} width={480}>
          <form className="g-form g-modal-body" onSubmit={handleCreateUser}>
            {createError && (
              <div className="g-alert" role="alert"><Icon name="alert" size={16} /><span>{createError}</span></div>
            )}
            <div className="g-field">
              <label className="g-label" htmlFor="new-user-email">Email</label>
              <input
                id="new-user-email"
                className="g-input"
                type="email"
                inputMode="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                disabled={creating}
              />
            </div>
            <div className="g-field">
              <label className="g-label" htmlFor="new-user-name">Display name <span className="admin-muted">(optional)</span></label>
              <input
                id="new-user-name"
                className="g-input"
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                autoComplete="off"
                disabled={creating}
              />
            </div>
            <TempPasswordField id="new-user-password" value={newPassword} onChange={setNewPassword} disabled={creating} />
            <div className="g-field">
              <label className="g-label" htmlFor="new-user-role">Role</label>
              <select
                id="new-user-role"
                className="g-select"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                disabled={creating}
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="g-modal-actions">
              <button type="button" className="g-btn g-btn--secondary" onClick={() => setShowCreate(false)} disabled={creating}>
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn--primary" disabled={creating}>
                {creating ? 'Adding…' : 'Add user'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {resetUser && (
        <Modal
          title="Reset password"
          description={<>Set a temporary password for <strong>{resetUser.email}</strong>. They’ll be signed out and asked to choose a new one next time.</>}
          onClose={() => setResetUser(null)}
          busy={resetting}
          width={480}
        >
          <form className="g-form g-modal-body" onSubmit={handleResetPassword}>
            {resetError && (
              <div className="g-alert" role="alert"><Icon name="alert" size={16} /><span>{resetError}</span></div>
            )}
            <TempPasswordField id="reset-password" value={resetPassword} onChange={setResetPasswordValue} disabled={resetting} />
            <div className="g-modal-actions">
              <button type="button" className="g-btn g-btn--secondary" onClick={() => setResetUser(null)} disabled={resetting}>
                Cancel
              </button>
              <button type="submit" className="g-btn g-btn--primary" disabled={resetting}>
                {resetting ? 'Resetting…' : 'Reset password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  );
};
