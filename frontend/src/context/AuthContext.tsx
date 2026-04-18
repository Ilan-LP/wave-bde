'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AuthUser {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'POLE_LEAD' | 'MEMBRE';
  pole: string | null;
  photoUrl: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setIsLoading(false);
      return;
    }

    api.get<{ user: AuthUser }>('/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem('access_token'))
      .finally(() => setIsLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = await api.post<{ accessToken: string; user: AuthUser }>('/auth/login', { email, password });
    localStorage.setItem('access_token', data.accessToken);
    setUser(data.user);
  }

  function logout() {
    api.post('/auth/logout', {}).catch(() => null);
    localStorage.removeItem('access_token');
    setUser(null);
    window.location.href = '/login';
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return ctx;
}
