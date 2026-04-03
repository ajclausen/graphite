import { create } from 'zustand';
import {
  type UserInfo,
  login as apiLogin,
  logout as apiLogout,
  getMe,
  changePassword as apiChangePassword,
  onAuthError,
} from '../api/client';

interface AuthState {
  user: UserInfo | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string, newEmail?: string, newDisplayName?: string) => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email, password) => {
    const { user } = await apiLogin(email, password);
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    await apiLogout();
    set({ user: null, isAuthenticated: false });
  },

  changePassword: async (currentPassword, newPassword, newEmail, newDisplayName) => {
    const { user } = await apiChangePassword(currentPassword, newPassword, newEmail, newDisplayName);
    set({ user });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const { user } = await getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));

// Listen for 401 errors from other API calls and force logout
onAuthError(() => {
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
  });
});
