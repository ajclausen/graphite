import React, { useId, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { BrandMark } from './AppHeader';
import { PasswordInput } from './ui/PasswordInput';
import { Icon } from './ui/Icon';
import './AuthPages.css';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const errorId = useId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(/too many/i.test(message)
        ? 'Too many sign-in attempts. Wait a few minutes and try again.'
        : message || 'Sign-in failed. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page" id="main">
      <div className="auth-card">
        <div className="auth-brand"><BrandMark /></div>
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Welcome back. Sign in to open your documents.</p>

        <form className="g-form auth-form" onSubmit={handleSubmit} noValidate={false}>
          {error && (
            <div className="g-alert" role="alert" id={errorId}>
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className="g-field">
            <label className="g-label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="g-input"
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>

          <div className="g-field">
            <label className="g-label" htmlFor="login-password">Password</label>
            <PasswordInput
              id="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
          </div>

          <button className="g-btn g-btn--primary g-btn--block auth-submit" type="submit" disabled={loading}>
            {loading && <span className="g-spinner g-spinner--sm auth-spinner" aria-hidden="true" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="auth-footnote">Forgot your password? Ask an administrator to reset it.</p>
      </div>
    </main>
  );
};
