import {
  createContext, useContext, useEffect, useState, useCallback, useRef,
  type ReactNode,
} from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  group_id: string;
  role: string;
  isPlatformAdmin: boolean;
  token: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8081/auth';
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM || 'coldchain';
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'coldchain-web';

// Refresh the access token this many milliseconds before it expires.
const REFRESH_BUFFER_MS = 60_000; // 1 minute

function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: window.location.origin + '/auth/callback',
    response_type: 'code',
    scope: 'openid profile email coldchain-scope',
  });
  return `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params}`;
}

async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(
    `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: KEYCLOAK_CLIENT_ID,
        code,
        redirect_uri: window.location.origin + '/auth/callback',
      }),
    },
  );
  if (!res.ok) throw new Error('Token exchange failed');
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  try {
    const res = await fetch(
      `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: KEYCLOAK_CLIENT_ID,
          refresh_token: refreshToken,
        }),
      },
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function parseJwt(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

function userFromToken(token: string, isPlatformAdmin: boolean): User {
  const claims = parseJwt(token);
  return {
    id: claims.sub as string,
    email: claims.email as string,
    name: (claims.preferred_username || claims.email) as string,
    group_id: claims.group_id as string,
    role: (claims.role || 'viewer') as string,
    isPlatformAdmin,
    token,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleRefresh(expiresInSeconds: number) {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    const delay = Math.max(0, expiresInSeconds * 1000 - REFRESH_BUFFER_MS);
    refreshTimerRef.current = setTimeout(async () => {
      const storedRefresh = sessionStorage.getItem('refresh_token');
      if (!storedRefresh) { setUser(null); return; }

      const tokens = await refreshAccessToken(storedRefresh);
      if (!tokens) {
        // Refresh token expired — force re-login
        sessionStorage.removeItem('access_token');
        sessionStorage.removeItem('refresh_token');
        sessionStorage.removeItem('is_platform_admin');
        setUser(null);
        return;
      }

      sessionStorage.setItem('access_token', tokens.access_token);
      sessionStorage.setItem('refresh_token', tokens.refresh_token);
      const isPlatformAdmin = sessionStorage.getItem('is_platform_admin') === 'true';
      setUser(userFromToken(tokens.access_token, isPlatformAdmin));
      scheduleRefresh(tokens.expires_in);
    }, delay);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');

    if (code && url.pathname === '/auth/callback') {
      exchangeCode(code)
        .then(async ({ access_token, refresh_token, expires_in }) => {
          sessionStorage.setItem('access_token', access_token);
          sessionStorage.setItem('refresh_token', refresh_token);

          let isPlatformAdmin = false;
          try {
            const res = await fetch('/api/v1/auth/sync', {
              method: 'POST',
              headers: { Authorization: `Bearer ${access_token}` },
            });
            if (res.ok) {
              const data = await res.json();
              isPlatformAdmin = data.is_platform_admin ?? false;
            }
          } catch {
            // Non-fatal
          }
          sessionStorage.setItem('is_platform_admin', String(isPlatformAdmin));

          scheduleRefresh(expires_in);
          window.location.replace('/');
        })
        .catch((err) => {
          console.error('Auth callback failed:', err);
          window.history.replaceState({}, '', '/');
        })
        .finally(() => setIsLoading(false));
    } else {
      const storedToken = sessionStorage.getItem('access_token');
      const storedRefresh = sessionStorage.getItem('refresh_token');
      if (storedToken) {
        try {
          const claims = parseJwt(storedToken);
          const exp = (claims.exp as number) * 1000;
          const isPlatformAdmin = sessionStorage.getItem('is_platform_admin') === 'true';
          if (exp > Date.now()) {
            setUser(userFromToken(storedToken, isPlatformAdmin));
            scheduleRefresh(Math.floor((exp - Date.now()) / 1000));
          } else if (storedRefresh) {
            // Access token expired but we have a refresh token — try silently
            refreshAccessToken(storedRefresh).then(tokens => {
              if (tokens) {
                sessionStorage.setItem('access_token', tokens.access_token);
                sessionStorage.setItem('refresh_token', tokens.refresh_token);
                setUser(userFromToken(tokens.access_token, isPlatformAdmin));
                scheduleRefresh(tokens.expires_in);
              } else {
                sessionStorage.removeItem('access_token');
                sessionStorage.removeItem('refresh_token');
                sessionStorage.removeItem('is_platform_admin');
              }
            }).finally(() => setIsLoading(false));
            return;
          } else {
            sessionStorage.removeItem('access_token');
            sessionStorage.removeItem('is_platform_admin');
          }
        } catch {
          sessionStorage.removeItem('access_token');
          sessionStorage.removeItem('refresh_token');
          sessionStorage.removeItem('is_platform_admin');
        }
      }
      setIsLoading(false);
    }

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const login = useCallback(() => {
    window.location.href = getAuthUrl();
  }, []);

  const logout = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    setUser(null);
    sessionStorage.removeItem('access_token');
    sessionStorage.removeItem('refresh_token');
    sessionStorage.removeItem('is_platform_admin');
    localStorage.removeItem('as_group_id');
    const logoutUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout`;
    const params = new URLSearchParams({
      client_id: KEYCLOAK_CLIENT_ID,
      post_logout_redirect_uri: window.location.origin,
    });
    window.location.href = `${logoutUrl}?${params}`;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
