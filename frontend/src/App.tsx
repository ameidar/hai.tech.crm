import { BrowserRouter, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
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
import OperationsHours from './pages/OperationsHours';
import OperationsControl from './pages/OperationsControl';
import Tasks from './pages/Tasks';
import WorkHoursApproval from './pages/WorkHoursApproval';
import InviteSetup from './pages/InviteSetup';
import ResetPassword from './pages/ResetPassword';
import MeetingStatus from './pages/MeetingStatus';
import AuditLog from './pages/AuditLog';
import Quotes from './pages/Quotes';
import MorningInvoiceTest from './pages/MorningInvoiceTest';
import PaymentLink from './pages/PaymentLink';
import QuoteWizard from './pages/QuoteWizard';
import QuoteDetail from './pages/QuoteDetail';
import QuoteEdit from './pages/QuoteEdit';
import PublicQuoteView from './pages/PublicQuoteView';
import PublicCancelForm from './pages/PublicCancelForm';
import LeadAppointments from './pages/LeadAppointments';
import InstitutionalOrders from './pages/InstitutionalOrders';
import InstitutionalOrderDetail from './pages/InstitutionalOrderDetail';
import PayingBodies from './pages/PayingBodies';
import BillingPeriods from './pages/BillingPeriods';
import BillingPeriodDetail from './pages/BillingPeriodDetail';
import SystemUsers from './pages/SystemUsers';
import WhatsAppInbox from './pages/WhatsAppInbox';
import MessengerInbox from './pages/MessengerInbox';
import InstagramInbox from './pages/InstagramInbox';
import Campaigns from './pages/Campaigns';
import FacebookLeads from './pages/FacebookLeads';
import Analytics from './pages/Analytics';
import GoogleAdsCampaigns from './pages/GoogleAdsCampaigns';
import LinkedIn from './pages/LinkedIn';
import FacebookPage from './pages/Facebook';
import InstagramPage from './pages/Instagram';
import TikTokPage from './pages/TikTok';
import YouTubePage from './pages/YouTube';
import CampaignLanding from './pages/CampaignLanding';
import PayPage from './pages/PayPage';

// Mobile instructor pages
import MobileMeetings from './pages/instructor/MobileMeetings';
import MobileMeetingDetail from './pages/instructor/MobileMeetingDetail';
import MobileAttendanceOverview from './pages/instructor/MobileAttendanceOverview';
import MobileProfile from './pages/instructor/MobileProfile';
import MobileCourseLibrary from './pages/instructor/MobileCourseLibrary';
import MobileAiAssistant from './pages/instructor/MobileAiAssistant';
import InstructorMagicMeeting from './pages/InstructorMagicMeeting';

function MeetingRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/meetings?openMeeting=${id}`} replace />;
}

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
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  return <>{children}</>;
}

// Blocks access for 'sales' role — redirects to WhatsApp inbox
function defaultRouteForRole(role?: string) {
  if (role === 'instructor') return '/instructor';
  if (role === 'sales') return '/whatsapp';
  if (role === 'operations') return '/operations-control';
  return '/';
}

function RoleRoute({ allowed, children }: { allowed: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !allowed.includes(user.role)) {
    return <Navigate to={defaultRouteForRole(user?.role)} replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuth();
  const isMobile = useIsMobile();
  const isInstructor = user?.role === 'instructor';
  const isSales = user?.role === 'sales';
  const isOperations = user?.role === 'operations';

  // Redirect based on role
  const getDefaultRoute = () => {
    return defaultRouteForRole(user?.role);
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
      <Route path="/public/cancel/:token" element={<PublicCancelForm />} />
      <Route path="/campaign/:campaignId" element={<CampaignLanding />} />
      <Route path="/pay/:token" element={<PayPage />} />
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
          <Route path="library" element={<MobileCourseLibrary />} />
          <Route path="ai" element={<MobileAiAssistant />} />
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
        <Route index element={isInstructor || isSales || isOperations ? <Navigate to={getDefaultRoute()} replace /> : <Dashboard />} />
        <Route path="operations" element={<RoleRoute allowed={['admin', 'manager']}><OperationsHours /></RoleRoute>} />
        <Route path="tasks" element={<RoleRoute allowed={['admin', 'manager', 'operations']}><Tasks /></RoleRoute>} />
        {!isInstructor && (
          <>
            {/* Sales-accessible routes */}
            <Route path="customers" element={<RoleRoute allowed={['admin', 'manager']}><Customers /></RoleRoute>} />
            <Route path="customers/:id" element={<RoleRoute allowed={['admin', 'manager']}><CustomerDetail /></RoleRoute>} />
            <Route path="whatsapp" element={<RoleRoute allowed={['admin', 'manager', 'sales']}><WhatsAppInbox /></RoleRoute>} />
            <Route path="messenger" element={<RoleRoute allowed={['admin', 'manager']}><MessengerInbox /></RoleRoute>} />
            <Route path="instagram" element={<RoleRoute allowed={['admin', 'manager']}><InstagramInbox /></RoleRoute>} />

            {/* Admin/Manager only routes — sales gets redirected to /whatsapp */}
            <Route path="students" element={<RoleRoute allowed={['admin', 'manager']}><Students /></RoleRoute>} />
            <Route path="courses" element={<RoleRoute allowed={['admin', 'manager']}><Courses /></RoleRoute>} />
            <Route path="branches" element={<RoleRoute allowed={['admin', 'manager']}><Branches /></RoleRoute>} />
            <Route path="instructors" element={<RoleRoute allowed={['admin', 'manager']}><Instructors /></RoleRoute>} />
            <Route path="cycles" element={<RoleRoute allowed={['admin', 'manager']}><Cycles /></RoleRoute>} />
            <Route path="cycles/:id" element={<RoleRoute allowed={['admin', 'manager']}><CycleDetail /></RoleRoute>} />
            <Route path="meetings" element={<RoleRoute allowed={['admin', 'manager']}><Meetings /></RoleRoute>} />
            <Route path="meetings/:id" element={<RoleRoute allowed={['admin', 'manager']}><MeetingRedirect /></RoleRoute>} />
            <Route path="operations-control" element={<RoleRoute allowed={['admin', 'manager', 'operations']}><OperationsControl /></RoleRoute>} />
            <Route path="quotes" element={<RoleRoute allowed={['admin', 'manager']}><Quotes /></RoleRoute>} />
            <Route path="quotes/new" element={<RoleRoute allowed={['admin', 'manager']}><QuoteWizard /></RoleRoute>} />
            <Route path="quotes/:id" element={<RoleRoute allowed={['admin', 'manager']}><QuoteDetail /></RoleRoute>} />
            <Route path="quotes/:id/edit" element={<RoleRoute allowed={['admin', 'manager']}><QuoteEdit /></RoleRoute>} />
            <Route path="institutional-orders" element={<RoleRoute allowed={['admin', 'manager']}><InstitutionalOrders /></RoleRoute>} />
            <Route path="institutional-orders/:id" element={<RoleRoute allowed={['admin', 'manager']}><InstitutionalOrderDetail /></RoleRoute>} />
            <Route path="paying-bodies" element={<RoleRoute allowed={['admin', 'manager']}><PayingBodies /></RoleRoute>} />
            <Route path="billing" element={<RoleRoute allowed={['admin', 'manager']}><BillingPeriods /></RoleRoute>} />
            <Route path="billing/:id" element={<RoleRoute allowed={['admin', 'manager']}><BillingPeriodDetail /></RoleRoute>} />
            <Route path="lead-appointments" element={<RoleRoute allowed={['admin', 'manager', 'sales']}><LeadAppointments /></RoleRoute>} />
            <Route path="system-users" element={<RoleRoute allowed={['admin']}><SystemUsers /></RoleRoute>} />
            <Route path="reports" element={<RoleRoute allowed={['admin', 'manager']}><Reports /></RoleRoute>} />
            <Route path="work-hours" element={<RoleRoute allowed={['admin', 'manager']}><WorkHoursApproval /></RoleRoute>} />
            <Route path="morning-invoice" element={<RoleRoute allowed={['admin', 'manager']}><MorningInvoiceTest /></RoleRoute>} />
            <Route path="payment-link" element={<RoleRoute allowed={['admin', 'manager', 'sales']}><PaymentLink /></RoleRoute>} />
            <Route path="audit" element={<RoleRoute allowed={['admin']}><AuditLog /></RoleRoute>} />
            <Route path="campaigns" element={<RoleRoute allowed={['admin', 'manager']}><Campaigns /></RoleRoute>} />
            <Route path="facebook-leads" element={<RoleRoute allowed={['admin', 'manager']}><FacebookLeads /></RoleRoute>} />
            <Route path="analytics" element={<RoleRoute allowed={['admin', 'manager']}><Analytics /></RoleRoute>} />
            <Route path="google-ads" element={<RoleRoute allowed={['admin', 'manager']}><GoogleAdsCampaigns /></RoleRoute>} />
            <Route path="linkedin" element={<RoleRoute allowed={['admin', 'manager']}><LinkedIn /></RoleRoute>} />
            <Route path="facebook" element={<RoleRoute allowed={['admin', 'manager']}><FacebookPage /></RoleRoute>} />
            <Route path="instagram-post" element={<RoleRoute allowed={['admin', 'manager']}><InstagramPage /></RoleRoute>} />
            <Route path="tiktok" element={<RoleRoute allowed={['admin', 'manager']}><TikTokPage /></RoleRoute>} />
            <Route path="youtube" element={<RoleRoute allowed={['admin', 'manager']}><YouTubePage /></RoleRoute>} />
          </>
        )}
        <Route path="instructor" element={<InstructorDashboard />} />
        
        {/* Desktop instructor meeting detail (fallback) */}
        <Route path="instructor/meeting/:id" element={<MobileMeetingDetail />} />
        {/* Course library — accessible for all instructors */}
        <Route path="instructor/library" element={<MobileCourseLibrary />} />
        {/* AI Assistant — accessible for all instructors */}
        <Route path="instructor/ai" element={<MobileAiAssistant />} />
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
