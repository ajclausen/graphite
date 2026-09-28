import React, { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { toast, errorMessage } from '../store/uiStore';
import { Modal } from './ui/Modal';

interface ChangePasswordModalProps {
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ onClose }) => {
  const changePassword = useAuthStore((s) => s.changePassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords don’t match.');
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('Password updated');
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Couldn’t change your password.'));
      setSaving(false);
    }
  };

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  return (
    <Modal title="Change password" description="You’ll stay signed in here. Other devices will be signed out." onClose={onClose} busy={saving}>
      <form className="g-form" onSubmit={handleSubmit}>
        {error && <div className="g-form-error" role="alert">{error}</div>}
        <label className="g-field">
          Current password
          <input
            className="g-input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={saving}
          />
        </label>
        <label className="g-field">
          New password
          <input
            className="g-input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
            autoComplete="new-password"
            disabled={saving}
          />
        </label>
        <label className="g-field">
          Confirm new password
          <input
            className="g-input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            aria-invalid={mismatch}
            disabled={saving}
            style={mismatch ? { borderColor: 'var(--g-danger)' } : undefined}
          />
        </label>
        <div className="g-modal-actions">
          <button type="button" className="g-btn g-btn--secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="g-btn g-btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
