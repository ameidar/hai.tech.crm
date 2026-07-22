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

function defaultRouteForRole(role?: string) {
  if (role === 'instructor') return '/instructor';
  if (role === 'sales') return '/lead-appointments';
  if (role === 'operations' || role === 'operations_control') return '/operations-control';
  return '/';
}

function RoleRoute({ allowed, children }: { allowed: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !allowed.includes(user.role)) {
    return <Navigate to={defaultRouteForRole(user?.role)} replace />;
  }
  return <>{children}</>;
}

function ManagementRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute allowed={['admin', 'manager', 'operations_manager']}>{children}</RoleRoute>;
}

function AdminManagerRoute({ children }: { children: React.ReactNode }) {
  return <RoleRoute allowed={['admin', 'manager']}>{children}</RoleRoute>;
}

function AppRoutes() {
  const { isAuthenticated, user } = useAuth();
  const isMobile = useIsMobile();
  const isInstructor = user?.role === 'instructor';
  const isSales = user?.role === 'sales';
  const isOperations = user?.role === 'operations';
  const isOperationsControl = user?.role === 'operations_control';
  const isInstructorLike = isInstructor || (isOperationsControl && Boolean(user?.instructor?.id));

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
      {isInstructorLike && isMobile ? (
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
        <Route index element={isInstructor || isSales || isOperations || isOperationsControl ? <Navigate to={getDefaultRoute()} replace /> : <Dashboard />} />
        <Route path="operations" element={<AdminManagerRoute><OperationsHours /></AdminManagerRoute>} />
        <Route path="operations-control" element={<RoleRoute allowed={['admin', 'manager', 'operations', 'operations_control', 'operations_manager']}><OperationsControl /></RoleRoute>} />
        <Route path="tasks" element={<RoleRoute allowed={['admin', 'manager', 'operations', 'operations_control', 'operations_manager']}><Tasks /></RoleRoute>} />
        {!isInstructor && (
          <>
            {/* Sales-accessible routes */}
            <Route path="customers" element={<ManagementRoute><Customers /></ManagementRoute>} />
            <Route path="customers/:id" element={<ManagementRoute><CustomerDetail /></ManagementRoute>} />
            <Route path="whatsapp" element={<WhatsAppInbox />} />
            <Route path="messenger" element={<AdminManagerRoute><MessengerInbox /></AdminManagerRoute>} />
            <Route path="instagram" element={<AdminManagerRoute><InstagramInbox /></AdminManagerRoute>} />

            {/* Admin/Manager only routes — sales gets redirected to /whatsapp */}
            <Route path="students" element={<ManagementRoute><Students /></ManagementRoute>} />
            <Route path="courses" element={<ManagementRoute><Courses /></ManagementRoute>} />
            <Route path="branches" element={<ManagementRoute><Branches /></ManagementRoute>} />
            <Route path="instructors" element={<ManagementRoute><Instructors /></ManagementRoute>} />
            <Route path="cycles" element={<ManagementRoute><Cycles /></ManagementRoute>} />
            <Route path="cycles/:id" element={<ManagementRoute><CycleDetail /></ManagementRoute>} />
            <Route path="meetings" element={<ManagementRoute><Meetings /></ManagementRoute>} />
            <Route path="meetings/:id" element={<ManagementRoute><MeetingRedirect /></ManagementRoute>} />
            <Route path="quotes" element={<AdminManagerRoute><Quotes /></AdminManagerRoute>} />
            <Route path="quotes/new" element={<AdminManagerRoute><QuoteWizard /></AdminManagerRoute>} />
            <Route path="quotes/:id" element={<AdminManagerRoute><QuoteDetail /></AdminManagerRoute>} />
            <Route path="quotes/:id/edit" element={<AdminManagerRoute><QuoteEdit /></AdminManagerRoute>} />
            <Route path="institutional-orders" element={<AdminManagerRoute><InstitutionalOrders /></AdminManagerRoute>} />
            <Route path="institutional-orders/:id" element={<AdminManagerRoute><InstitutionalOrderDetail /></AdminManagerRoute>} />
            <Route path="paying-bodies" element={<AdminManagerRoute><PayingBodies /></AdminManagerRoute>} />
            <Route path="billing" element={<AdminManagerRoute><BillingPeriods /></AdminManagerRoute>} />
            <Route path="billing/:id" element={<AdminManagerRoute><BillingPeriodDetail /></AdminManagerRoute>} />
            <Route path="lead-appointments" element={<RoleRoute allowed={['admin', 'manager', 'sales', 'operations_control']}><LeadAppointments /></RoleRoute>} />
            <Route path="system-users" element={<AdminManagerRoute><SystemUsers /></AdminManagerRoute>} />
            <Route path="reports" element={<AdminManagerRoute><Reports /></AdminManagerRoute>} />
            <Route path="work-hours" element={<AdminManagerRoute><WorkHoursApproval /></AdminManagerRoute>} />
            <Route path="morning-invoice" element={<AdminManagerRoute><MorningInvoiceTest /></AdminManagerRoute>} />
            <Route path="payment-link" element={<RoleRoute allowed={['admin', 'manager', 'sales', 'operations_control']}><PaymentLink /></RoleRoute>} />
            <Route path="audit" element={<AdminManagerRoute><AuditLog /></AdminManagerRoute>} />
            <Route path="campaigns" element={<AdminManagerRoute><Campaigns /></AdminManagerRoute>} />
            <Route path="facebook-leads" element={<AdminManagerRoute><FacebookLeads /></AdminManagerRoute>} />
            <Route path="analytics" element={<AdminManagerRoute><Analytics /></AdminManagerRoute>} />
            <Route path="google-ads" element={<AdminManagerRoute><GoogleAdsCampaigns /></AdminManagerRoute>} />
            <Route path="linkedin" element={<AdminManagerRoute><LinkedIn /></AdminManagerRoute>} />
            <Route path="facebook" element={<AdminManagerRoute><FacebookPage /></AdminManagerRoute>} />
            <Route path="instagram-post" element={<AdminManagerRoute><InstagramPage /></AdminManagerRoute>} />
            <Route path="tiktok" element={<AdminManagerRoute><TikTokPage /></AdminManagerRoute>} />
            <Route path="youtube" element={<AdminManagerRoute><YouTubePage /></AdminManagerRoute>} />
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
