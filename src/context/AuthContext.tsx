import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { User, UserRole } from '../types/auth';
import * as api from '../api';

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    role: UserRole,
    details: api.SignupDetails
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .getMe()
      .then(setUser)
      .catch(() => {
        api.clearAuthToken();
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await api.login(email, password);
    setUser(next);
  }, []);

  const register = useCallback(
    async (
      email: string,
      password: string,
      role: UserRole,
      details: api.SignupDetails
    ) => {
      const next = await api.register(email, password, role, details);
      setUser(next);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, logout }),
    [user, isLoading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
