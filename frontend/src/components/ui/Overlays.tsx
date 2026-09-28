import React from 'react';
import { createPortal } from 'react-dom';
import { useUIStore, type ToastKind } from '../../store/uiStore';
import { Modal } from './Modal';
import { Icon } from './Icon';
import './ui.css';

const TOAST_ICONS: Record<ToastKind, React.ReactNode> = {
  success: <polyline points="20 6 9 17 4 12" />,
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
};

const Toaster: React.FC = () => {
  const toasts = useUIStore((s) => s.toasts);
  const dismiss = useUIStore((s) => s.dismissToast);

  return createPortal(
    <div className="g-toaster" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`g-toast g-toast--${t.kind}`}
          role={t.kind === 'error' ? 'alert' : 'status'}
        >
          <svg className="g-toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {TOAST_ICONS[t.kind]}
          </svg>
          <div className="g-toast-body">
            <div className="g-toast-message">{t.message}</div>
            {t.description && <div className="g-toast-description">{t.description}</div>}
          </div>
          <button className="g-toast-close g-icon-btn g-icon-btn--sm" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
};

const ConfirmHost: React.FC = () => {
  const pending = useUIStore((s) => s.confirm);
  const resolve = useUIStore((s) => s.resolveConfirm);

  if (!pending) return null;

  return (
    <Modal title={pending.title} description={pending.message} onClose={() => resolve(false)} width={420} role="alertdialog">
      <div className="g-modal-actions">
        {/* Destructive confirms start on Cancel so a stray Enter can't delete anything */}
        <button className="g-btn g-btn--secondary" onClick={() => resolve(false)} data-autofocus={pending.danger ? true : undefined}>
          {pending.cancelLabel ?? 'Cancel'}
        </button>
        <button
          className={`g-btn ${pending.danger ? 'g-btn--danger' : 'g-btn--primary'}`}
          onClick={() => resolve(true)}
          data-autofocus={pending.danger ? undefined : true}
        >
          {pending.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </Modal>
  );
};

/** Mount once at the app root: renders toasts and the shared confirm dialog. */
export const GlobalOverlays: React.FC = () => (
  <>
    <Toaster />
    <ConfirmHost />
  </>
);
