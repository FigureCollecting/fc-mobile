import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: { username: string; email: string } | null;
  isAuthenticated: boolean;
  setToken: (token: string) => void;
  setUser: (user: { username: string; email: string }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  setToken: (token: string) => set({ token, isAuthenticated: true }),

  setUser: (user: { username: string; email: string }) => set({ user }),

  logout: () => set({ token: null, user: null, isAuthenticated: false }),
}));
