import { Thermometer, LogIn } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card p-10 max-w-sm w-full text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-cold-400 to-cold-600 flex items-center justify-center mx-auto mb-6">
          <Thermometer className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-semibold text-white mb-2">
          Cold Chain Monitor
        </h1>
        <p className="text-cold-300/70 text-sm mb-8">
          Sign in to access your monitoring dashboard
        </p>
        <button
          onClick={login}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-cold-500 hover:bg-cold-400 text-white font-medium transition-colors"
        >
          <LogIn className="w-5 h-5" />
          Sign In
        </button>
        <p className="text-cold-400 text-xs mt-6">
          Protected by Keycloak SSO
        </p>
      </div>
    </div>
  );
}
