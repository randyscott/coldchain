import {
  createContext, useContext, useEffect, useState, useCallback,
  type ReactNode,
} from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  group_id: string;
  role: string;
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

// Config — set VITE_AUTH_ENABLED=true to enable Keycloak
const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';
const KEYCLOAK_URL = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8081/auth';
const KEYCLOAK_REALM = import.meta.env.VITE_KEYCLOAK_REALM || 'coldchain';
const KEYCLOAK_CLIENT_ID = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'coldchain-web';

// Dev-mode mock user
const MOCK_USER: User = {
  id: 'b0000000-0000-0000-0000-000000000001',
  email: 'admin@demo.local',
  name: 'Demo Admin',
  group_id: 'a0000000-0000-0000-0000-000000000001',
  role: 'admin',
  token: '',
};

// OIDC helpers
function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: window.location.origin + '/auth/callback',
    response_type: 'code',
    scope: 'openid profile email coldchain-scope',
  });
  return `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth?${params}`;
}

async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string }> {
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

function parseJwt(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(base64));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Handle OIDC callback
  useEffect(() => {
    if (!AUTH_ENABLED) {
      setUser(MOCK_USER);
      setIsLoading(false);
      return;
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');

    if (code && url.pathname === '/auth/callback') {
      // Exchange authorization code for tokens
      exchangeCode(code)
        .then(({ access_token }) => {
          const claims = parseJwt(access_token);
          setUser({
            id: claims.sub as string,
            email: claims.email as string,
            name: (claims.preferred_username || claims.email) as string,
            group_id: claims.group_id as string,
            role: (claims.role || 'viewer') as string,
            token: access_token,
          });
          // Store token for API calls
          sessionStorage.setItem('access_token', access_token);
          // Clean up URL
          window.history.replaceState({}, '', '/');
        })
        .catch((err) => {
          console.error('Auth callback failed:', err);
          window.history.replaceState({}, '', '/');
        })
        .finally(() => setIsLoading(false));
    } else {
      // Check for existing token
      const storedToken = sessionStorage.getItem('access_token');
      if (storedToken) {
        try {
          const claims = parseJwt(storedToken);
          // Check if expired
          const exp = (claims.exp as number) * 1000;
          if (exp > Date.now()) {
            setUser({
              id: claims.sub as string,
              email: claims.email as string,
              name: (claims.preferred_username || claims.email) as string,
              group_id: claims.group_id as string,
              role: (claims.role || 'viewer') as string,
              token: storedToken,
            });
          } else {
            sessionStorage.removeItem('access_token');
          }
        } catch {
          sessionStorage.removeItem('access_token');
        }
      }
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(() => {
    if (AUTH_ENABLED) {
      window.location.href = getAuthUrl();
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    sessionStorage.removeItem('access_token');
    if (AUTH_ENABLED) {
      const logoutUrl = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/logout`;
      const params = new URLSearchParams({
        client_id: KEYCLOAK_CLIENT_ID,
        post_logout_redirect_uri: window.location.origin,
      });
      window.location.href = `${logoutUrl}?${params}`;
    }
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
