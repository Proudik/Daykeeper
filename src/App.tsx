import { useState } from 'react';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AuthScreen } from '@/screens/AuthScreen';
import { Onboarding } from '@/screens/Onboarding';
import { DayView } from '@/screens/DayView';
import { SavedTimesheetsPage } from '@/screens/SavedTimesheetsPage';
import { ConnectionsPage } from '@/screens/ConnectionsPage';
import { SettingsPage } from '@/screens/SettingsPage';
import { AdminLogsPage } from '@/screens/AdminLogsPage';
import { ConnectedBrowsersPage } from '@/screens/ConnectedBrowsersPage';
import { AppShell, type View } from '@/components/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { installGlobalErrorHandlers } from '@/lib/errorLogger';
import { todayLocal } from '@/lib/time';

installGlobalErrorHandlers();

function AppContent() {
  const { user, profile, loading } = useAuth();
  const [view, setView] = useState<View>('day');
  const [selectedDate, setSelectedDate] = useState(todayLocal());

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-100">
        <p className="text-sm text-stone-400">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (profile && !profile.onboarded) {
    return <Onboarding />;
  }

  return (
    <AppShell
      view={view}
      onViewChange={setView}
      selectedDate={selectedDate}
      onDateChange={setSelectedDate}
    >
      {view === 'day' && (
        <DayView selectedDate={selectedDate} onDateChange={setSelectedDate} />
      )}
      {view === 'timesheets' && <SavedTimesheetsPage />}
      {view === 'connections' && <ConnectionsPage />}
      {view === 'settings' && <SettingsPage />}
      {view === 'logs' && <AdminLogsPage />}
      {view === 'browsers' && <ConnectedBrowsersPage />}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}
