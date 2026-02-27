import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import MobileInstructorLayout from './components/MobileInstructorLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Students from './pages/Students';
import Courses from './pages/Courses';
import Branches from './pages/Branches';
import Instructors from './pages/Instructors';
import Cycles from './pages/Cycles';
import CycleDetail from './pages/CycleDetail';
import Meetings from './pages/Meetings';
import Reports from './pages/Reports';
import InstructorDashboard from './pages/InstructorDashboard';
import InviteSetup from './pages/InviteSetup';
import ResetPassword from './pages/ResetPassword';
import MeetingStatus from './pages/MeetingStatus';
import AuditLog from './pages/AuditLog';
import Quotes from './pages/Quotes';
import QuoteWizard from './pages/QuoteWizard';
import QuoteDetail from './pages/QuoteDetail';
import QuoteEdit from './pages/QuoteEdit';
import PublicQuoteView from './pages/PublicQuoteView';
import PublicCancelForm from './pages/PublicCancelForm';
import LeadAppointments from './pages/LeadAppointments';
import InstitutionalOrders from './pages/InstitutionalOrders';
import SystemUsers from './pages/SystemUsers';
import WhatsAppInbox from './pages/WhatsAppInbox';

// Mobile instructor pages
import MobileMeetings from './pages/instructor/MobileMeetings';
import MobileMeetingDetail from './pages/instructor/MobileMeetingDetail';
import MobileAttendanceOverview from './pages/instructor/MobileAttendanceOverview';
import MobileProfile from './pages/instructor/MobileProfile';
import InstructorMagicMeeting from './pages/InstructorMagicMeeting';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Detect if user is on a mobile device
 */
function useIsMobile() {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuth();
  const isMobile = useIsMobile();
  const isInstructor = user?.role === 'instructor';

  // Redirect based on role
  const getDefaultRoute = () => {
    if (isInstructor) return '/instructor';
    return '/';
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={getDefaultRoute()} replace /> : <Login />}
      />
      <Route path="/invite/:token" element={<InviteSetup />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/public/quote/:id" element={<PublicQuoteView />} />
      <Route path="/cancel/:token" element={<PublicCancelForm />} />
      <Route path="/m/:meetingId/:token" element={<MeetingStatus />} />
      <Route path="/i/:meetingId/:token" element={<InstructorMagicMeeting />} />
      
      {/* Mobile Instructor Routes */}
      {isInstructor && isMobile ? (
        <Route
          path="/instructor"
          element={
            <ProtectedRoute>
              <MobileInstructorLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<MobileMeetings />} />
          <Route path="meeting/:id" element={<MobileMeetingDetail />} />
          <Route path="attendance" element={<MobileAttendanceOverview />} />
          <Route path="profile" element={<MobileProfile />} />
        </Route>
      ) : null}

      {/* Desktop Routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={isInstructor ? <Navigate to="/instructor" replace /> : <Dashboard />} />
        {!isInstructor && (
          <>
            <Route path="customers" element={<Customers />} />
            <Route path="customers/:id" element={<CustomerDetail />} />
            <Route path="students" element={<Students />} />
            <Route path="courses" element={<Courses />} />
            <Route path="branches" element={<Branches />} />
            <Route path="instructors" element={<Instructors />} />
            <Route path="cycles" element={<Cycles />} />
            <Route path="cycles/:id" element={<CycleDetail />} />
            <Route path="meetings" element={<Meetings />} />
            <Route path="quotes" element={<Quotes />} />
            <Route path="quotes/new" element={<QuoteWizard />} />
            <Route path="quotes/:id" element={<QuoteDetail />} />
            <Route path="quotes/:id/edit" element={<QuoteEdit />} />
            <Route path="institutional-orders" element={<InstitutionalOrders />} />
            <Route path="lead-appointments" element={<LeadAppointments />} />
            <Route path="system-users" element={<SystemUsers />} />
            <Route path="whatsapp" element={<WhatsAppInbox />} />
            <Route path="reports" element={<Reports />} />
            <Route path="audit" element={<AuditLog />} />
          </>
        )}
        <Route path="instructor" element={<InstructorDashboard />} />
        
        {/* Desktop instructor meeting detail (fallback) */}
        <Route path="instructor/meeting/:id" element={<MobileMeetingDetail />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
