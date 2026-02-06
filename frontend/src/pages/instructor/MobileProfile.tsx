import { useNavigate } from 'react-router-dom';
import { 
  User, 
  Phone, 
  Mail, 
  LogOut,
  Calendar,
  CheckCircle2,
  Clock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useMeetings } from '../../hooks/useApi';
import { useMemo } from 'react';

/**
 * Simple profile page for instructors on mobile
 */
export default function MobileProfile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  // Get this month's stats
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
  
  const { data: meetings } = useMeetings({ from: firstOfMonth, to: lastOfMonth });

  const monthStats = useMemo(() => {
    if (!meetings || !Array.isArray(meetings)) return { total: 0, completed: 0 };
    return {
      total: meetings.length,
      completed: meetings.filter(m => m.status === 'completed').length,
    };
  }, [meetings]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="p-4">
      {/* Profile Card */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 text-center mb-6">
        <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
          <span className="text-3xl font-bold text-white">
            {user?.name?.charAt(0) || 'M'}
          </span>
        </div>
        <h1 className="text-xl font-bold text-gray-800 mb-1">
          {user?.name || 'מדריך'}
        </h1>
        <p className="text-gray-500">מדריך</p>
      </div>

      {/* Contact Info */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
        <h2 className="text-sm font-medium text-gray-500 mb-3">פרטי קשר</h2>
        <div className="space-y-3">
          {user?.email && (
            <div className="flex items-center gap-3 text-gray-700">
              <Mail size={18} className="text-gray-400" />
              <span>{user.email}</span>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Stats */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 mb-6">
        <h2 className="text-sm font-medium text-gray-500 mb-3">סטטיסטיקות החודש</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <Calendar size={24} className="text-blue-500 mx-auto mb-2" />
            <div className="text-2xl font-bold text-gray-800">{monthStats.total}</div>
            <div className="text-sm text-gray-500">שיעורים</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-center">
            <CheckCircle2 size={24} className="text-green-500 mx-auto mb-2" />
            <div className="text-2xl font-bold text-gray-800">{monthStats.completed}</div>
            <div className="text-sm text-gray-500">הושלמו</div>
          </div>
        </div>
      </div>

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        className="w-full bg-red-50 text-red-600 rounded-2xl p-4 flex items-center justify-center gap-2 font-medium border border-red-100 transition-colors hover:bg-red-100"
      >
        <LogOut size={20} />
        התנתק
      </button>

      {/* Version */}
      <p className="text-center text-gray-400 text-xs mt-6">
        HaiTech CRM v1.0
      </p>
    </div>
  );
}
