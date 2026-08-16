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
    <div className="min-h-screen bg-cream-100 flex flex-col font-sans text-trust-slate antialiased">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-cream-50 rounded-[28px] border border-cream-300 shadow-xl p-6 md:p-8 animate-fadeIn">
          <div className="text-center mb-6">
            <img
              src="/GentleTrike.png"
              alt="GentleTrike"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
              className="inline-block w-14 h-14 object-contain rounded-card border border-cream-300 bg-cream-50 shadow-xs mb-3"
            />
            <h2 className="text-2xl font-display font-black text-trust-slate">Admin Portal</h2>
            <p className="text-sm font-sans text-cream-600 mt-1.5 font-medium">Authorized TMO personnel only.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="employeeId" className="kicker-label block mb-1.5">
                Employee ID
              </label>
              <input
                id="employeeId"
                type="text"
                required
                autoComplete="username"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                placeholder="e.g. TMO-104"
              />
            </div>

            <div>
              <label htmlFor="password" className="kicker-label block mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <p className="text-xs font-sans font-bold text-sunset-coral bg-sunset-coral/15 border border-sunset-coral/30 rounded-card px-3 py-2.5">
                {error}
              </p>
            )}

            {blockedMsg && (
              <div className="rounded-card border border-sunset-coral/30 bg-cream-100 p-3.5 space-y-2">
                <p className="text-xs font-sans font-bold text-sunset-coral">{blockedMsg}</p>
                {alreadyPending || appealState === 'done' ? (
                  <p className="text-xs font-sans font-bold text-sampaguita-green">
                    ⏳ Waiting for request approval — your reactivation request is under review by the TMO.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <label className="kicker-label block">
                      Request reactivation — tell the TMO why:
                    </label>
                    <textarea
                      rows={3}
                      value={appealReason}
                      onChange={(e) => setAppealReason(e.target.value)}
                      placeholder="Explain why your account should be reactivated..."
                      className="w-full px-3 py-2 rounded-card border border-cream-300 bg-cream-50 text-xs font-sans font-medium text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold"
                    />
                    {appealError && <p className="text-xs font-sans font-bold text-sunset-coral">{appealError}</p>}
                    <button
                      type="button"
                      onClick={handleAppeal}
                      disabled={appealState === 'submitting'}
                      className="btn-primary w-full py-2 text-xs font-display font-bold shadow-xs disabled:opacity-60"
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
              className="btn-primary w-full py-3.5 text-sm font-display font-extrabold shadow-md flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <LogIn className="w-4 h-4" />
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs font-sans text-cream-600 mt-6 font-medium">
            Not staff?{' '}
            <a href="/" className="text-trust-slate font-display font-bold underline hover:text-trike-gold">
              Go to the passenger &amp; rider app
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
