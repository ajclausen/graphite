import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ui.css';

interface ModalProps {
  title: string;
  description?: React.ReactNode;
  onClose: () => void;
  /** Blocks Escape/backdrop dismissal while an operation is in flight. */
  busy?: boolean;
  width?: number;
  /** Use "alertdialog" for confirmations that interrupt the user. */
  role?: 'dialog' | 'alertdialog';
  children?: React.ReactNode;
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({ title, description, onClose, busy = false, width = 440, role = 'dialog', children }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // Focus the first field (or the dialog itself) unless a child already grabbed focus.
    if (dialog && !dialog.contains(document.activeElement)) {
      const autofocus = dialog.querySelector<HTMLElement>('[data-autofocus]')
        ?? dialog.querySelector<HTMLElement>('input, select, textarea')
        ?? dialog;
      autofocus.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      // Keep Tab cycling inside the dialog.
      if (event.key === 'Tab' && dialog) {
        const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="g-modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="g-modal"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        style={{ width: `min(100%, ${width}px)` }}
      >
        <h2 id={titleId} className="g-modal-title">{title}</h2>
        {description && <div id={descriptionId} className="g-modal-description">{description}</div>}
        {children}
      </div>
    </div>,
    document.body,
  );
};
