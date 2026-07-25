import React, { useState } from 'react';
import { Bike, LogIn, UserPlus, Users } from 'lucide-react';
import type { UserRole } from '../types/auth';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api';

type AuthMode = 'login' | 'register';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('passenger');
  const [unitNumber, setUnitNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name, role, role === 'rider' ? unitNumber : undefined);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900 antialiased">
      <header className="bg-white border-b border-gray-200 shadow-xs">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-center gap-3">
          <img
            src="/GentleTrike.png"
            alt="GentleTrike Logo"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            className="w-10 h-10 object-contain rounded-xl shadow-xs border border-amber-200 bg-white"
          />
          <h1 className="text-xl font-black text-gray-900 tracking-tight">GentleTrike</h1>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-md p-6 md:p-8 animate-fadeIn">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-black text-gray-900">
              {mode === 'login' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="text-sm text-gray-500 mt-1.5 font-medium">
              {mode === 'login'
                ? 'Sign in to book rides or go on duty as a rider.'
                : 'Join GentleTrike as a passenger or Dumaguete pedicab rider.'}
            </p>
          </div>

          <div className="flex rounded-xl bg-gray-100 p-1 mb-6">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition ${
                mode === 'login'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition ${
                mode === 'register'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="name" className="block text-xs font-bold text-gray-700 mb-1.5">
                    Full name
                  </label>
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                    placeholder="Juan dela Cruz"
                  />
                </div>

                <div>
                  <span className="block text-xs font-bold text-gray-700 mb-2">I am a</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole('passenger')}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-bold transition ${
                        role === 'passenger'
                          ? 'border-amber-400 bg-amber-50 text-gray-900'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Users className="w-5 h-5" />
                      Passenger
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('rider')}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-bold transition ${
                        role === 'rider'
                          ? 'border-amber-400 bg-amber-50 text-gray-900'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Bike className="w-5 h-5" />
                      Rider
                    </button>
                  </div>
                </div>

                {role === 'rider' && (
                  <div>
                    <label htmlFor="unitNumber" className="block text-xs font-bold text-gray-700 mb-1.5">
                      Pedicab Number
                    </label>
                    <input
                      id="unitNumber"
                      type="text"
                      required
                      value={unitNumber}
                      onChange={(e) => setUnitNumber(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                      placeholder="e.g. 0412"
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-bold text-gray-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                placeholder="At least 8 characters"
              />
            </div>

            {error && (
              <p className="text-xs font-bold text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 disabled:cursor-not-allowed text-gray-900 font-black text-sm transition shadow-xs active:scale-[0.98]"
            >
              {isSubmitting
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>

          <p className="text-center text-xs text-gray-500 mt-6 font-medium">
            {mode === 'login' ? (
              <>
                New to GentleTrike?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="text-gray-900 font-bold underline hover:text-amber-600"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="text-gray-900 font-bold underline hover:text-amber-600"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
