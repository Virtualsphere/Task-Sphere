import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { HuddleProvider } from './huddle/HuddleContext';
import HuddleWindow from './huddle/HuddleWindow';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import SpacePage from './pages/SpacePage';
import Messages from './pages/Messages';
import CalendarPage from './pages/CalendarPage';
import { config } from './config';

const TestModeBanner = () => (config.devLogin || config.calendarSimulated) ? (
  <div className="demo-banner"><strong>Local test mode</strong>{config.calendarSimulated && ' · Google Calendar & Meet links are simulated'}</div>
) : null;

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  // The huddle provider sits above the routes, so a call keeps going while you move around the app
  return (
    <HuddleProvider>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/spaces/:spaceId" element={<SpacePage />} />
        <Route path="/spaces/:spaceId/lists/:listId" element={<SpacePage />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/messages/:conversationId" element={<Messages />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <HuddleWindow />
      <TestModeBanner />
    </HuddleProvider>
  );
}
