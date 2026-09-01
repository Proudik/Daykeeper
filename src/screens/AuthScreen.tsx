import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

type Mode = 'signin' | 'signup' | 'reset';

export function AuthScreen() {
  const { refreshProfile } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Account created. You are now signed in.');
        await new Promise((r) => setTimeout(r, 500));
        await refreshProfile();
      } else if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMessage('Password reset link sent — check your inbox.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Daykeeper</h1>
          <p className="mt-1 text-sm text-stone-500">Daily timesheet generator for lawyers</p>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex gap-1 rounded-md bg-stone-100 p-1">
            <button
              onClick={() => setMode('signin')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'signin' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
              }`}
            >
              Sign in
            </button>
            <button
              onClick={() => setMode('signup')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === 'signup' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
              }`}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@firm.com"
              />
            </div>
            {mode !== 'reset' && (
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  placeholder="At least 6 characters"
                />
              </div>
            )}

            {error && <p className="text-sm text-red-700">{error}</p>}
            {message && <p className="text-sm text-accent-700">{message}</p>}

            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy
                ? 'Please wait...'
                : mode === 'signin'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'}
            </button>
          </form>

          <div className="mt-4 text-center">
            {mode !== 'reset' ? (
              <button
                onClick={() => {
                  setMode('reset');
                  setError(null);
                  setMessage(null);
                }}
                className="text-xs text-stone-500 hover:text-stone-800"
              >
                Forgot password?
              </button>
            ) : (
              <button
                onClick={() => {
                  setMode('signin');
                  setError(null);
                  setMessage(null);
                }}
                className="text-xs text-stone-500 hover:text-stone-800"
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
