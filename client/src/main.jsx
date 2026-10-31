import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';

// Route-level code splitting: the login page no longer downloads the dashboard, charts or admin code.
const AuthPage = lazy(() => import('./pages/AuthPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));

const Splash = () => <div className="splash" role="status" aria-live="polite">Loading…</div>;
function App() {
  const { user, ready, isAdmin } = useAuth();
  // Admins land on the admin console and can flip to their own member dashboard (they have a wallet too).
  const [view, setView] = useState('admin');
  useEffect(() => { setView('admin'); }, [user?._id]);
  if (!ready) return <Splash/>;
  return <Suspense fallback={<Splash/>}>
    {!user ? <AuthPage/> : isAdmin && view === 'admin' ? <AdminDashboard onSwitchView={() => setView('member')}/> : <Dashboard onSwitchView={isAdmin ? () => setView('admin') : null}/>}
  </Suspense>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary><AuthProvider><App/></AuthProvider></ErrorBoundary></React.StrictMode>);
