// Thin fetch wrapper for the RoadSense FastAPI backend.
//
// Exposes one helper, `apiFetch(path, { token, ...init })`, which:
//   - prefixes API_BASE_URL
//   - attaches Authorization: Bearer <token> when a token is provided
//   - parses JSON and throws an Error with the server-provided `detail`
//
// The base URL is read from Expo public env (`EXPO_PUBLIC_API_URL`) so it can
// be changed per environment without code edits. It falls back to localhost
// for web and the Android emulator loopback for native dev builds.

import { Platform } from 'react-native';

const DEV_FALLBACK =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || DEV_FALLBACK;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch(path, { token, headers, ...init } = {}) {
  const finalHeaders = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // localtunnel / ngrok free tier can intercept the first request with
    // a "click to continue" HTML page. Both services honor this header to
    // bypass that interstitial. Harmless on any other backend.
    'bypass-tunnel-reminder': 'true',
    'ngrok-skip-browser-warning': 'true',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: finalHeaders,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(
      'Cannot reach the server. Check your internet connection.',
      0,
    );
  }

  const text = await response.text();
  const data = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    const detail =
      (data && (data.detail || data.message)) ||
      `Request failed (${response.status})`;
    throw new ApiError(
      typeof detail === 'string' ? detail : JSON.stringify(detail),
      response.status,
    );
  }

  return data;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const authApi = {
  login: (email, password) =>
    apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: (token) => apiFetch('/api/auth/me', { token }),
};

export const riskApi = {
  // POST /api/predict-risk
  //   payload: { latitude, longitude, speed, heading }
  //   returns: { risk_score, risk_level, alert_message }
  predict: (token, payload, { signal } = {}) =>
    apiFetch('/api/predict-risk', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
      signal,
    }),
};

export const historyApi = {
  // GET /api/history/trips → { count, trips: [...] }
  list: (token, { limit = 50, skip = 0 } = {}) =>
    apiFetch(`/api/history/trips?limit=${limit}&skip=${skip}`, { token }),

  // POST /api/history/trips
  //   payload: { started_at, ended_at, route: [TripPoint],
  //              average_r_total (0-1), alert_count, distance_km?, notes? }
  create: (token, payload) =>
    apiFetch('/api/history/trips', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
};
