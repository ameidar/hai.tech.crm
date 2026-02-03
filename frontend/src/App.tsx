import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout';
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
import MeetingStatus from './pages/MeetingStatus';
import AuditLog from './pages/AuditLog';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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

  // Redirect based on role
  const getDefaultRoute = () => {
    if (user?.role === 'instructor') return '/instructor';
    return '/';
  };

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to={getDefaultRoute()} replace /> : <Login />}
      />
      <Route path="/invite/:token" element={<InviteSetup />} />
      <Route path="/m/:meetingId/:token" element={<MeetingStatus />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={user?.role === 'instructor' ? <Navigate to="/instructor" replace /> : <Dashboard />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="students" element={<Students />} />
        <Route path="courses" element={<Courses />} />
        <Route path="branches" element={<Branches />} />
        <Route path="instructors" element={<Instructors />} />
        <Route path="cycles" element={<Cycles />} />
        <Route path="cycles/:id" element={<CycleDetail />} />
        <Route path="meetings" element={<Meetings />} />
        <Route path="reports" element={<Reports />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="instructor" element={<InstructorDashboard />} />
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
