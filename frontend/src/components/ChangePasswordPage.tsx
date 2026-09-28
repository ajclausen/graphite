import React, { useId, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { errorMessage } from '../store/uiStore';
import { BrandMark } from './AppHeader';
import { PasswordInput } from './ui/PasswordInput';
import { Icon } from './ui/Icon';
import './AuthPages.css';

/** First sign-in with a temporary or bootstrap password: pick real credentials. */
export const ChangePasswordPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const changePassword = useAuthStore((s) => s.changePassword);
  const logout = useAuthStore((s) => s.logout);

  const isBootstrapAdmin = user?.email === 'admin@graphite.local';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const errorId = useId();
  const newHintId = useId();
  const confirmHintId = useId();

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Your new password needs at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords don’t match.');
      return;
    }
    if (newEmail && !/^\S+@\S+\.\S+$/.test(newEmail.trim())) {
      setError('Enter a valid email address, or leave it blank to keep the current one.');
      return;
    }

    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword, newEmail.trim() || undefined, newDisplayName.trim() || undefined);
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t update your account. Please try again.'));
      setLoading(false);
    }
  };

  return (
    <main className="auth-page" id="main">
      <div className="auth-card auth-card--wide">
        <div className="auth-brand"><BrandMark /></div>
        <h1 className="auth-title">Set up your account</h1>
        <p className="auth-subtitle">
          {isBootstrapAdmin
            ? 'Choose your own email and password to replace the temporary admin login.'
            : 'You signed in with a temporary password. Choose a new one to continue.'}
        </p>

        <form className="g-form auth-form" onSubmit={handleSubmit}>
          {error && (
            <div className="g-alert" role="alert" id={errorId}>
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}

          <fieldset className="auth-fieldset">
            <legend className="auth-legend">Your details</legend>
            <div className="g-field">
              <label className="g-label" htmlFor="setup-email">Email <span className="auth-optional">(optional)</span></label>
              <input
                id="setup-email"
                className="g-input"
                type="email"
                inputMode="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={user?.email || 'you@example.com'}
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
              />
              <span className="g-hint">Leave blank to keep {user?.email}.</span>
            </div>
            <div className="g-field">
              <label className="g-label" htmlFor="setup-name">Display name <span className="auth-optional">(optional)</span></label>
              <input
                id="setup-name"
                className="g-input"
                type="text"
                value={newDisplayName}
                onChange={(e) => setNewDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
          </fieldset>

          <fieldset className="auth-fieldset">
            <legend className="auth-legend">Password</legend>
            <div className="g-field">
              <label className="g-label" htmlFor="setup-current">
                {isBootstrapAdmin ? 'Temporary password' : 'Current password'}
              </label>
              <PasswordInput
                id="setup-current"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
                autoComplete="current-password"
              />
            </div>
            <div className="g-field">
              <label className="g-label" htmlFor="setup-new">New password</label>
              <PasswordInput
                id="setup-new"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                aria-invalid={tooShort || undefined}
                aria-describedby={newHintId}
              />
              <span id={newHintId} className={`g-hint${tooShort ? ' is-error' : ''}`}>At least 8 characters.</span>
            </div>
            <div className="g-field">
              <label className="g-label" htmlFor="setup-confirm">Confirm new password</label>
              <PasswordInput
                id="setup-confirm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? confirmHintId : undefined}
              />
              {mismatch && <span id={confirmHintId} className="g-hint is-error">Passwords don’t match yet.</span>}
            </div>
          </fieldset>

          <button className="g-btn g-btn--primary g-btn--block auth-submit" type="submit" disabled={loading}>
            {loading && <span className="g-spinner g-spinner--sm auth-spinner" aria-hidden="true" />}
            {loading ? 'Saving…' : 'Save and continue'}
          </button>
          <button className="g-btn g-btn--ghost g-btn--block" type="button" onClick={() => void logout()} disabled={loading}>
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
};
