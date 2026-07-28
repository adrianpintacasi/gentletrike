import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { ApiError, submitActivationRequest } from '../api';

/**
 * Isolated TMO staff / admin sign-in, reached at its own URL (/staff).
 * No sign-up — staff accounts are issued by a super-admin. Login is by
 * Employee ID + password (the backend accepts the ID in the identifier field).
 */
export function StaffLoginPage() {
  const { login } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const [alreadyPending, setAlreadyPending] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealState, setAppealState] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [appealError, setAppealError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBlockedMsg(null);
    setAlreadyPending(false);
    setAppealState('idle');
    setIsSubmitting(true);
    try {
      await login(employeeId.trim(), password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setBlockedMsg(err.message);
        setAlreadyPending(!!err.data?.hasPendingRequest);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAppeal = async () => {
    if (!appealReason.trim()) {
      setAppealError('Please enter a reason for your appeal.');
      return;
    }
    setAppealState('submitting');
    setAppealError(null);
    try {
      await submitActivationRequest(employeeId.trim(), password, appealReason.trim());
      setAppealState('done');
    } catch (err) {
      setAppealError(err instanceof ApiError ? err.message : 'Could not submit your request. Try again.');
      setAppealState('idle');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-blue-100 flex flex-col font-sans text-gray-900 antialiased">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-blue-100 shadow-lg p-6 md:p-8 animate-fadeIn">
          <div className="text-center mb-6">
            <img
              src="/GentleTrike.png"
              alt="GentleTrike"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
              className="inline-block w-14 h-14 object-contain rounded-2xl border border-amber-200 bg-white shadow-sm mb-3"
            />
            <h2 className="text-2xl font-black text-gray-900">Admin Portal</h2>
            <p className="text-sm text-gray-500 mt-1.5 font-medium">Authorized TMO personnel only.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="employeeId" className="block text-xs font-bold text-gray-700 mb-1.5">
                Employee ID
              </label>
              <input
                id="employeeId"
                type="text"
                required
                autoComplete="username"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. TMO-104"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                {error}
              </p>
            )}

            {blockedMsg && (
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 space-y-2">
                <p className="text-xs font-bold text-orange-800">{blockedMsg}</p>
                {alreadyPending || appealState === 'done' ? (
                  <p className="text-xs font-bold text-emerald-700">
                    ⏳ Waiting for request approval — your reactivation request is under review by the TMO.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold text-orange-800">
                      Request reactivation — tell the TMO why:
                    </label>
                    <textarea
                      rows={3}
                      value={appealReason}
                      onChange={(e) => setAppealReason(e.target.value)}
                      placeholder="Explain why your account should be reactivated..."
                      className="w-full px-3 py-2 rounded-lg border border-orange-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-400"
                    />
                    {appealError && <p className="text-xs font-bold text-red-600">{appealError}</p>}
                    <button
                      type="button"
                      onClick={handleAppeal}
                      disabled={appealState === 'submitting'}
                      className="w-full py-2 rounded-lg bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white font-bold text-xs transition"
                    >
                      {appealState === 'submitting' ? 'Submitting...' : 'Submit reactivation request'}
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black text-sm transition shadow-sm active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <LogIn className="w-4 h-4" />
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-500 mt-6 font-medium">
            Not staff?{' '}
            <a href="/" className="text-blue-700 font-bold underline hover:text-blue-800">
              Go to the passenger &amp; rider app
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
