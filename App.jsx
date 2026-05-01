import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import Login from './Login';
import ManagerDashboard from './ManagerDashboard';
import EmployeeDashboard from './EmployeeDashboard';

function ProtectedRoute({ children, requiredRole }) {
  const { user, loading } = useAuth();
  console.log('[ProtectedRoute] loading:', loading, 'user:', user);
  if (loading) return <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'var(--accent)', background: '#0a0f1a' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (requiredRole && user.role !== requiredRole) return <Navigate to="/" replace />;
  return children;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'manager' ? '/manager' : '/employee'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/manager/*" element={
            <ProtectedRoute requiredRole="manager">
              <ManagerDashboard />
            </ProtectedRoute>
          } />
          <Route path="/employee/*" element={
            <ProtectedRoute requiredRole="employee">
              <EmployeeDashboard />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
