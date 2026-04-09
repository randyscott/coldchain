import { NavLink, Outlet } from 'react-router-dom';
import { Thermometer, LayoutDashboard, Bell, LogOut, Cpu } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../../hooks/useAuth';
import { useAlertStream } from '../../hooks/useAlertStream';
import { useActiveAlertCount } from '../../hooks/useActiveAlertCount';

export function AppLayout() {
  const { user, logout } = useAuth();
  useAlertStream();
  const activeAlertCount = useActiveAlertCount();
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-cold-700/30 bg-cold-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cold-400 to-cold-600 flex items-center justify-center">
                <Thermometer className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white tracking-tight">
                  Cold Chain Monitor
                </h1>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-1">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  clsx(isActive ? 'nav-link-active' : 'nav-link', 'flex items-center gap-2')
                }
              >
                <LayoutDashboard className="w-4 h-4" />
                Dashboard
              </NavLink>
              <NavLink
                to="/alerts"
                className={({ isActive }) =>
                  clsx(isActive ? 'nav-link-active' : 'nav-link', 'flex items-center gap-2')
                }
              >
                <Bell className="w-4 h-4" />
                Alerts
                {activeAlertCount > 0 && (
                  <span className="ml-0.5 min-w-[1.1rem] h-[1.1rem] px-0.5 rounded-full bg-alert-critical text-white text-[10px] font-bold flex items-center justify-center leading-none">
                    {activeAlertCount > 99 ? '99+' : activeAlertCount}
                  </span>
                )}
              </NavLink>
              {user?.role === 'admin' && (
                <NavLink
                  to="/profiles"
                  className={({ isActive }) =>
                    clsx(isActive ? 'nav-link-active' : 'nav-link', 'flex items-center gap-2')
                  }
                >
                  <Cpu className="w-4 h-4" />
                  Profiles
                </NavLink>
              )}
            </nav>

            {/* User */}
            <div className="flex items-center gap-3">
              {user && (
                <>
                  <div className="text-right hidden sm:block">
                    <div className="text-sm font-medium text-cold-200">{user.name}</div>
                    <div className="text-xs text-cold-400">{user.role}</div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-cold-700 flex items-center justify-center text-sm font-medium text-cold-200">
                    {user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <button
                    onClick={logout}
                    className="text-xs text-cold-400 hover:text-white transition-colors ml-1"
                    title="Sign out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full">
        <Outlet />
      </main>
    </div>
  );
}
