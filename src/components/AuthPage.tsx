import React, { useState } from 'react';
import { Bike, LogIn, UserPlus, Users } from 'lucide-react';
import type { UserRole } from '../types/auth';
import { useAuth } from '../context/AuthContext';
import { ApiError, submitActivationRequest } from '../api';

type AuthMode = 'login' | 'register';

const VEHICLE_OPTIONS = [
  { value: 'pedicab_standard', label: 'Pedicab' },
  { value: 'habal_habal', label: 'Motorcycle (Habal-Habal)' },
  { value: 'multicab', label: 'EasyRide (Multicab)' },
];

// Shrink the chosen photo to a small JPEG data URL so it stays well under the
// upload limit and doesn't bloat the database.
async function fileToResizedDataUrl(file: File, maxSize = 400): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('That file is not a valid image'));
    image.src = dataUrl;
  });
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [role, setRole] = useState<UserRole>('passenger');
  const [sex, setSex] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [address, setAddress] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('pedicab_standard');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Suspended/banned appeal flow (shown when login is blocked with a 403).
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const [alreadyPending, setAlreadyPending] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealState, setAppealState] = useState<'idle' | 'submitting' | 'done'>('idle');
  const [appealError, setAppealError] = useState<string | null>(null);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setBlockedMsg(null);
  };

  const handleAppeal = async () => {
    if (!appealReason.trim()) {
      setAppealError('Please enter a reason for your appeal.');
      return;
    }
    setAppealState('submitting');
    setAppealError(null);
    try {
      await submitActivationRequest(email, password, appealReason.trim());
      setAppealState('done');
    } catch (err) {
      setAppealError(err instanceof ApiError ? err.message : 'Could not submit your request. Try again.');
      setAppealState('idle');
    }
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError(null);
    if (!file.type.startsWith('image/')) {
      setPhotoError('Please choose an image file.');
      return;
    }
    try {
      setPhoto(await fileToResizedDataUrl(file));
    } catch {
      setPhotoError('Could not process that image. Try another.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBlockedMsg(null);
    setAlreadyPending(false);
    setAppealState('idle');
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, role, {
          firstName,
          lastName,
          contactNumber,
          ...(role === 'rider'
            ? { unitNumber, vehicleType, photo: photo ?? undefined, sex, birthdate, address }
            : {}),
        });
      }
    } catch (err) {
      // A blocked (suspended/banned) login → offer the reactivation appeal.
      if (mode === 'login' && err instanceof ApiError && err.status === 403) {
        setBlockedMsg(err.message);
        setAlreadyPending(!!err.data?.hasPendingRequest);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
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
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="firstName" className="block text-xs font-bold text-gray-700 mb-1.5">
                      First name
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      autoComplete="given-name"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                      placeholder="Juan"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="block text-xs font-bold text-gray-700 mb-1.5">
                      Last name
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      autoComplete="family-name"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                      placeholder="dela Cruz"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="contactNumber" className="block text-xs font-bold text-gray-700 mb-1.5">
                    Contact number
                  </label>
                  <input
                    id="contactNumber"
                    type="tel"
                    autoComplete="tel"
                    required
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                    placeholder="09XX XXX XXXX"
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
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="sex" className="block text-xs font-bold text-gray-700 mb-1.5">
                          Sex
                        </label>
                        <select
                          id="sex"
                          required
                          value={sex}
                          onChange={(e) => setSex(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                        >
                          <option value="" disabled>
                            Select
                          </option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="birthdate" className="block text-xs font-bold text-gray-700 mb-1.5">
                          Birthdate
                        </label>
                        <input
                          id="birthdate"
                          type="date"
                          required
                          value={birthdate}
                          onChange={(e) => setBirthdate(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="address" className="block text-xs font-bold text-gray-700 mb-1.5">
                        Address
                      </label>
                      <input
                        id="address"
                        type="text"
                        autoComplete="street-address"
                        required
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                        placeholder="Purok / Barangay, Dumaguete City"
                      />
                    </div>

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

                    <div>
                      <label htmlFor="vehicleType" className="block text-xs font-bold text-gray-700 mb-1.5">
                        Vehicle type
                      </label>
                      <select
                        id="vehicleType"
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
                      >
                        {VEHICLE_OPTIONS.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <span className="block text-xs font-bold text-gray-700 mb-1.5">
                        Profile photo <span className="font-medium text-gray-400">(optional)</span>
                      </span>
                      <div className="flex items-center gap-3">
                        {photo ? (
                          <img
                            src={photo}
                            alt="Rider preview"
                            className="w-14 h-14 rounded-xl object-cover border border-gray-200"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-xl border border-dashed border-gray-300 flex items-center justify-center text-gray-300">
                            <Bike className="w-5 h-5" />
                          </div>
                        )}
                        <label className="cursor-pointer px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-700 hover:border-gray-300">
                          {photo ? 'Change photo' : 'Upload photo'}
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoChange}
                            className="hidden"
                          />
                        </label>
                      </div>
                      {photoError && (
                        <p className="text-xs font-bold text-red-600 mt-1.5">{photoError}</p>
                      )}
                    </div>
                  </>
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
