import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  Building2,
  UserCheck,
  RefreshCcw,
  Calendar,
  BarChart3,
  LogOut,
  Menu,
  X,
  ChevronDown,
} from 'lucide-react';

// Admin/Manager navigation
const adminNavItems = [
  { path: '/', icon: LayoutDashboard, label: 'דשבורד' },
  { path: '/customers', icon: Users, label: 'לקוחות' },
  { path: '/students', icon: GraduationCap, label: 'תלמידים' },
  { path: '/courses', icon: BookOpen, label: 'קורסים' },
  { path: '/branches', icon: Building2, label: 'סניפים' },
  { path: '/instructors', icon: UserCheck, label: 'מדריכים' },
  { path: '/cycles', icon: RefreshCcw, label: 'מחזורים' },
  { path: '/meetings', icon: Calendar, label: 'פגישות' },
  { path: '/reports', icon: BarChart3, label: 'דוחות' },
];

// Instructor-only navigation
const instructorNavItems = [
  { path: '/instructor', icon: LayoutDashboard, label: 'הפגישות שלי' },
  { path: '/meetings', icon: Calendar, label: 'כל הפגישות' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-slate-800 text-white transition-all duration-300 flex flex-col`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-700">
          {sidebarOpen ? (
            <img src="/logo.png" alt="דרך ההייטק" className="h-10 object-contain" />
          ) : (
            <img src="/logo.png" alt="דרך ההייטק" className="h-8 w-8 object-contain" />
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-slate-700 transition-colors"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4">
          {(user?.role === 'instructor' ? instructorNavItems : adminNavItems).map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 mx-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`
              }
            >
              <item.icon size={20} />
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-slate-700">
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 transition-colors"
            >
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                {user?.name?.charAt(0) || 'U'}
              </div>
              {sidebarOpen && (
                <>
                  <div className="flex-1 text-right">
                    <p className="text-sm font-medium">{user?.name}</p>
                    <p className="text-xs text-slate-400">{user?.role}</p>
                  </div>
                  <ChevronDown size={16} />
                </>
              )}
            </button>

            {userMenuOpen && (
              <div className="absolute bottom-full right-0 mb-2 w-full bg-slate-700 rounded-lg shadow-lg overflow-hidden">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-slate-600 transition-colors"
                >
                  <LogOut size={18} />
                  {sidebarOpen && <span>התנתק</span>}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
