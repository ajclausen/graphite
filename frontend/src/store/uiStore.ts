import { create } from 'zustand';

// ─── Toasts ──────────────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  description?: string;
}

// ─── Confirm dialog ──────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

interface UIState {
  toasts: Toast[];
  confirm: PendingConfirm | null;
  dismissToast: (id: number) => void;
  resolveConfirm: (confirmed: boolean) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  toasts: [],
  confirm: null,

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  resolveConfirm: (confirmed) => {
    const pending = get().confirm;
    if (!pending) return;
    set({ confirm: null });
    pending.resolve(confirmed);
  },
}));

let nextToastId = 1;
const TOAST_DURATION_MS: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  error: 6500,
};

function pushToast(kind: ToastKind, message: string, description?: string) {
  const id = nextToastId++;
  useUIStore.setState((state) => ({
    // Cap the stack so a burst of failures can't bury the UI.
    toasts: [...state.toasts, { id, kind, message, description }].slice(-4),
  }));
  setTimeout(() => useUIStore.getState().dismissToast(id), TOAST_DURATION_MS[kind]);
  return id;
}

export const toast = {
  success: (message: string, description?: string) => pushToast('success', message, description),
  error: (message: string, description?: string) => pushToast('error', message, description),
  info: (message: string, description?: string) => pushToast('info', message, description),
};

/** Promise-based replacement for window.confirm(). */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // A new confirm supersedes any still-open one.
    useUIStore.getState().confirm?.resolve(false);
    useUIStore.setState({ confirm: { ...options, resolve } });
  });
}

/** Pulls a human-readable message out of an unknown thrown value. */
export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message && !/^Request failed/.test(err.message)) {
    return err.message;
  }
  return fallback;
}
