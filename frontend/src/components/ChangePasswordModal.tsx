import React, { useId, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { toast, errorMessage } from '../store/uiStore';
import { Modal } from './ui/Modal';
import { PasswordInput } from './ui/PasswordInput';
import { Icon } from './ui/Icon';

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
  const newHintId = useId();
  const confirmHintId = useId();

  const tooShort = newPassword.length > 0 && newPassword.length < 8;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

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

  return (
    <Modal title="Change password" description="You’ll stay signed in here. Other devices will be signed out." onClose={onClose} busy={saving}>
      <form className="g-form g-modal-body" onSubmit={handleSubmit}>
        {error && (
          <div className="g-alert" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}
        <div className="g-field">
          <label className="g-label" htmlFor="cp-current">Current password</label>
          <PasswordInput
            id="cp-current"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={saving}
          />
        </div>
        <div className="g-field">
          <label className="g-label" htmlFor="cp-new">New password</label>
          <PasswordInput
            id="cp-new"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            disabled={saving}
            aria-invalid={tooShort || undefined}
            aria-describedby={newHintId}
          />
          <span id={newHintId} className={`g-hint${tooShort ? ' is-error' : ''}`}>At least 8 characters.</span>
        </div>
        <div className="g-field">
          <label className="g-label" htmlFor="cp-confirm">Confirm new password</label>
          <PasswordInput
            id="cp-confirm"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            disabled={saving}
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? confirmHintId : undefined}
          />
          {mismatch && <span id={confirmHintId} className="g-hint is-error">Passwords don’t match yet.</span>}
        </div>
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
