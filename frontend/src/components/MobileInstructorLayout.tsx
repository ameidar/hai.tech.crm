import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Calendar, ClipboardCheck, User, LogOut } from 'lucide-react';

/**
 * Mobile-optimized layout for instructors
 * Features bottom navigation for thumb-friendly access
 */
export default function MobileInstructorLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top Header - minimal */}
      <header className="bg-white shadow-sm px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="דרך ההייטק" className="h-8" />
          <span className="font-medium text-gray-700">שלום, {user?.name?.split(' ')[0]}</span>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 text-gray-500 hover:text-red-500 transition-colors"
          aria-label="התנתק"
        >
          <LogOut size={20} />
        </button>
      </header>

      {/* Main Content - with bottom padding for nav */}
      <main className="flex-1 overflow-auto pb-20">
        <Outlet />
      </main>

      {/* Bottom Navigation - fixed */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50 safe-area-bottom">
        <div className="flex justify-around items-center h-16">
          <NavLink
            to="/instructor"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Calendar size={24} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-xs mt-1 font-medium">פגישות</span>
              </>
            )}
          </NavLink>
          
          <NavLink
            to="/instructor/attendance"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <ClipboardCheck size={24} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-xs mt-1 font-medium">נוכחות</span>
              </>
            )}
          </NavLink>
          
          <NavLink
            to="/instructor/profile"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <User size={24} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-xs mt-1 font-medium">פרופיל</span>
              </>
            )}
          </NavLink>
        </div>
      </nav>
    </div>
  );
}
