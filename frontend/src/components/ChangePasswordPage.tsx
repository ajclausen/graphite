import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import './AuthPages.css';

export const ChangePasswordPage: React.FC = () => {
  const user = useAuthStore((s) => s.user);
  const changePassword = useAuthStore((s) => s.changePassword);

  const isMandatory = user?.mustChangePassword;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }

    if (isMandatory && newEmail && !newEmail.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(true);
    try {
      await changePassword(
        currentPassword,
        newPassword,
        isMandatory && newEmail ? newEmail : undefined,
        isMandatory ? newDisplayName || undefined : undefined,
      );
      if (!isMandatory) {
        setSuccess(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="auth-brand-mark" src="/graphite-logo.png" alt="Graphite logo" />
          <div className="auth-brand-text">
            <h1>Graphite</h1>
            <p className="auth-tagline">annotate &middot; sketch &middot; export</p>
          </div>
        </div>

        <h2 className="auth-title">
          {isMandatory ? 'Set up your account' : 'Change password'}
        </h2>

        {isMandatory && (
          <p className="auth-description auth-description--warning">
            Please set your credentials before continuing. The default password is required to verify your identity.
          </p>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">Password changed successfully.</div>}

          {isMandatory && (
            <>
              <label className="auth-label">
                Email
                <input
                  className="auth-input"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder={user?.email || 'you@example.com'}
                  autoComplete="email"
                />
              </label>

              <label className="auth-label">
                Display name
                <input
                  className="auth-input"
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Your name (optional)"
                  autoComplete="name"
                />
              </label>
            </>
          )}

          <label className="auth-label">
            {isMandatory ? 'Default password' : 'Current password'}
            <input
              className="auth-input"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder={isMandatory ? 'Enter the default password' : 'Enter current password'}
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
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
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
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>

          <button className="auth-submit" type="submit" disabled={loading}>
            {loading
              ? (isMandatory ? 'Setting up...' : 'Changing password...')
              : (isMandatory ? 'Complete setup' : 'Change password')}
          </button>
        </form>
      </div>
    </div>
  );
};
