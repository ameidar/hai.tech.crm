import { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import OnlineUsers from './OnlineUsers';
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
  FileText,
  Receipt,
  PhoneCall,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronLeft,
  UserCog,
  MessageCircle,
  MessagesSquare,
  Megaphone,
  Camera,
  Facebook,
  LineChart,
  Linkedin,
} from 'lucide-react';

// Admin/Manager navigation — grouped
const adminNavGroups = [
  {
    key: 'management',
    label: 'ניהול',
    items: [
      { path: '/', icon: LayoutDashboard, label: 'דשבורד', testId: 'nav-dashboard' },
      { path: '/customers', icon: Users, label: 'לקוחות', testId: 'nav-customers' },
      { path: '/students', icon: GraduationCap, label: 'תלמידים', testId: 'nav-students' },
      { path: '/courses', icon: BookOpen, label: 'קורסים', testId: 'nav-courses' },
      { path: '/branches', icon: Building2, label: 'סניפים', testId: 'nav-branches' },
      { path: '/instructors', icon: UserCheck, label: 'מדריכים', testId: 'nav-instructors' },
      { path: '/cycles', icon: RefreshCcw, label: 'מחזורים', testId: 'nav-cycles' },
      { path: '/meetings', icon: Calendar, label: 'פגישות', testId: 'nav-meetings' },
      { path: '/quotes', icon: Receipt, label: 'הצעות מחיר', testId: 'nav-quotes' },
      { path: '/institutional-orders', icon: FileText, label: 'הזמנות מוסדיות', testId: 'nav-institutional-orders' },
    ],
  },
  {
    key: 'marketing',
    label: '📣 שיווק',
    items: [
      { path: '/lead-appointments', icon: PhoneCall, label: 'יומן לידים', testId: 'nav-lead-appointments' },
      { path: '/whatsapp', icon: MessageCircle, label: 'WhatsApp', testId: 'nav-whatsapp' },
      { path: '/messenger', icon: MessagesSquare, label: 'Messenger', testId: 'nav-messenger' },
      { path: '/instagram', icon: Camera, label: 'Instagram', testId: 'nav-instagram' },
      { path: '/campaigns', icon: Megaphone, label: 'קמפיינים', testId: 'nav-campaigns' },
      { path: '/facebook-leads', icon: Facebook, label: 'לידים פייסבוק', testId: 'nav-facebook-leads' },
      { path: '/analytics', icon: LineChart, label: 'Google Analytics', testId: 'nav-analytics' },
      { path: '/linkedin', icon: Linkedin, label: 'LinkedIn', testId: 'nav-linkedin' },
    ],
  },
  {
    key: 'system',
    label: 'מערכת',
    items: [
      { path: '/system-users', icon: UserCog, label: 'ניהול הנהלה', testId: 'nav-system-users' },
      { path: '/reports', icon: BarChart3, label: 'דוחות', testId: 'nav-reports' },
      { path: '/audit', icon: FileText, label: 'יומן פעילות', testId: 'nav-audit' },
    ],
  },
];

// Instructor-only navigation
const instructorNavItems = [
  { path: '/instructor', icon: LayoutDashboard, label: 'הפגישות שלי', testId: 'nav-instructor' },
];

// Sales-only navigation (WhatsApp + Customers)
const salesNavItems = [
  { path: '/whatsapp', icon: MessageCircle, label: 'WhatsApp', testId: 'nav-whatsapp' },
  { path: '/customers', icon: Users, label: 'לקוחות', testId: 'nav-customers' },
];

const COLLAPSED_KEY = 'nav-collapsed-sections';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Collapsed sections state — persisted in localStorage
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const toggleSection = (key: string) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'manager';
  const isInstructor = user?.role === 'instructor';
  const isSales = user?.role === 'sales';

  // Flat items for non-admin roles
  const flatNavItems = isInstructor ? instructorNavItems : isSales ? salesNavItems : [];

  const renderNavItem = (item: { path: string; icon: any; label: string; testId: string }) => (
    <NavLink
      key={item.path}
      to={item.path}
      data-testid={item.testId}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg transition-colors min-h-[40px] ${
          isActive
            ? 'bg-blue-600 text-white'
            : 'text-slate-300 hover:bg-slate-700 hover:text-white'
        }`
      }
    >
      <item.icon size={20} className="flex-shrink-0" />
      {sidebarOpen && <span className="text-sm">{item.label}</span>}
    </NavLink>
  );

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-700">
        {sidebarOpen ? (
          <img src="/logo.png" alt="דרך ההייטק" className="h-10 object-contain" />
        ) : (
          <img src="/logo.png" alt="דרך ההייטק" className="h-8 w-8 object-contain" />
        )}
        {/* Desktop toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="hidden md:block p-2 rounded-lg hover:bg-slate-700 transition-colors"
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {/* Mobile close */}
        <button
          onClick={() => setMobileSidebarOpen(false)}
          className="md:hidden p-2 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto" data-testid="main-nav">
        {isAdmin ? (
          // Grouped navigation for admin/manager
          adminNavGroups.map((group) => {
            const isCollapsed = !!collapsedSections[group.key];
            return (
              <div key={group.key} className="mb-1">
                {/* Section header — only when sidebar is expanded */}
                {sidebarOpen ? (
                  <button
                    onClick={() => toggleSection(group.key)}
                    className="w-full flex items-center justify-between px-4 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hover:text-slate-200 transition-colors select-none"
                  >
                    <span>{group.label}</span>
                    {isCollapsed
                      ? <ChevronLeft size={14} />
                      : <ChevronDown size={14} />
                    }
                  </button>
                ) : (
                  // Narrow mode: separator line
                  <div className="mx-3 my-1 border-t border-slate-700" />
                )}

                {/* Items — hidden when collapsed (only when sidebar is open) */}
                {(!sidebarOpen || !isCollapsed) && (
                  <div className="mt-0.5">
                    {group.items.map(renderNavItem)}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          // Flat navigation for instructor/sales
          flatNavItems.map(renderNavItem)
        )}
      </nav>

      {/* Version + Build Time */}
      <div className="px-4 py-1 text-center">
        <span className="text-xs text-slate-500">v2.1</span>
        <span className="text-xs text-slate-600 block" title="זמן build">
          {new Date(__BUILD_TIME__).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Online Users (admin/manager only) */}
      {isAdmin && (
        <div className="px-4 pb-2">
          <OnlineUsers />
        </div>
      )}

      {/* User section */}
      <div className="p-4 border-t border-slate-700">
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
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
                className="w-full flex items-center gap-3 px-4 py-3 text-red-400 hover:bg-slate-600 transition-colors min-h-[44px]"
              >
                <LogOut size={18} />
                <span>התנתק</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Mobile Top Bar */}
      <div className="md:hidden bg-slate-800 text-white h-14 flex items-center justify-between px-4 sticky top-0 z-40">
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="p-2 rounded-lg hover:bg-slate-700 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <Menu size={24} />
        </button>
        <img src="/logo.png" alt="דרך ההייטק" className="h-8 object-contain" />
        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-sm font-medium">
          {user?.name?.charAt(0) || 'U'}
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-50"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <aside
            className="w-72 h-full bg-slate-800 text-white flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:flex ${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-slate-800 text-white transition-all duration-300 flex-col`}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-h-0">
        <Outlet />
      </main>

      {/* DEV branch indicator */}
      {import.meta.env.VITE_BRANCH === 'dev' && (
        <div style={{
          position: 'fixed',
          bottom: '12px',
          left: '12px',
          background: '#f59e0b',
          color: '#1c1917',
          fontSize: '11px',
          fontWeight: 700,
          padding: '3px 10px',
          borderRadius: '999px',
          zIndex: 9999,
          letterSpacing: '0.05em',
          boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
        }}>
          🌿 DEV
        </div>
      )}
    </div>
  );
}
