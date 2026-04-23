// Auth state container.
//
// Responsibilities:
//   - On boot, read the stored JWT from expo-secure-store and verify it with
//     the backend (`GET /api/auth/me`). Invalid / expired tokens are cleared.
//   - Expose `signIn(email, password)` which calls the backend and persists
//     the returned token.
//   - Expose `signOut()` which clears the stored token, returning the user
//     to the login screen on the next render.
//
// Only the JWT is persisted. User profile is held in memory and rehydrated
// from `/api/auth/me` on every launch, so a revoked/expired token is handled
// correctly without stale cached data.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { apiFetch, authApi, ApiError } from '../api/client';

const TOKEN_KEY = 'roadsense.jwt';

// expo-secure-store is not available on web; fall back to localStorage
// transparently so `expo start --web` still works during development.
const storage = {
  get: async (key) => {
    if (Platform.OS === 'web') {
      try {
        return typeof window !== 'undefined'
          ? window.localStorage.getItem(key)
          : null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  set: async (key, value) => {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.setItem(key, value);
      } catch {}
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  remove: async (key) => {
    if (Platform.OS === 'web') {
      try {
        window.localStorage.removeItem(key);
      } catch {}
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);

  // Boot-time token rehydration. Runs exactly once.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await storage.get(TOKEN_KEY);
        if (!stored) return;

        try {
          const profile = await authApi.me(stored);
          if (cancelled) return;
          setToken(stored);
          setUser(profile);
        } catch (err) {
          // Token invalid / expired / server rejecting it — wipe it so the
          // user sees the login screen instead of being stuck.
          if (err instanceof ApiError && err.status !== 0) {
            await storage.remove(TOKEN_KEY);
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { access_token } = await authApi.login(email.trim(), password);
    await storage.set(TOKEN_KEY, access_token);
    // Best-effort profile fetch — if /me fails we still consider the user
    // signed in, since the token itself was accepted by /login.
    let profile = null;
    try {
      profile = await authApi.me(access_token);
    } catch {}
    setToken(access_token);
    setUser(profile);
  }, []);

  const signOut = useCallback(async () => {
    await storage.remove(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      isLoading,
      isAuthenticated: Boolean(token),
      token,
      user,
      signIn,
      signOut,
    }),
    [isLoading, token, user, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
