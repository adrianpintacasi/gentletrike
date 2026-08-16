import React, { useState } from 'react';
import { Bike, LogIn, UserPlus, Users } from 'lucide-react';
import type { UserRole } from '../types/auth';
import { useAuth } from '../context/AuthContext';
import { ApiError, submitActivationRequest } from '../api';

type AuthMode = 'login' | 'register';

/*
 * One vehicle, so nothing to choose.
 *
 * Kept as a list rather than inlined: the moment a second vehicle comes back —
 * habal-habal is the obvious next one — this is the only place that changes,
 * and the select below starts offering a real choice again on its own.
 */
const VEHICLE_OPTIONS = [{ value: 'pedicab_standard', label: 'Pedicab' }];

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
    <div className="min-h-screen bg-cream-100 flex flex-col font-sans text-trust-slate antialiased">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-cream-50 rounded-[28px] border border-cream-300 shadow-xl p-6 md:p-8 animate-fadeIn">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2.5 mb-2">
              <img
                src="/GentleTrike.png"
                alt="GentleTrike"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
                className="w-10 h-10 object-contain rounded-card shadow-xs border border-cream-300 bg-cream-50"
              />
              <h2 className="text-2xl font-display font-black text-trust-slate tracking-tight">GentleTrike</h2>
            </div>
            <p className="text-sm font-sans text-cream-600 mt-1.5 font-medium">
              {mode === 'login'
                ? 'Sign in to book rides or go on duty as a rider.'
                : 'Join GentleTrike as a passenger or Dumaguete pedicab rider.'}
            </p>
          </div>

          <div className="flex rounded-pill bg-cream-200 p-1 mb-6 border border-cream-300">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-pill text-xs font-display font-bold transition ${
                mode === 'login'
                  ? 'bg-cream-50 text-trust-slate shadow-xs'
                  : 'text-cream-600 hover:text-trust-slate'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchMode('register')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-pill text-xs font-display font-bold transition ${
                mode === 'register'
                  ? 'bg-cream-50 text-trust-slate shadow-xs'
                  : 'text-cream-600 hover:text-trust-slate'
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
                    <label htmlFor="firstName" className="kicker-label block mb-1.5">
                      First name
                    </label>
                    <input
                      id="firstName"
                      type="text"
                      autoComplete="given-name"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                      placeholder="Juan"
                    />
                  </div>
                  <div>
                    <label htmlFor="lastName" className="kicker-label block mb-1.5">
                      Last name
                    </label>
                    <input
                      id="lastName"
                      type="text"
                      autoComplete="family-name"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                      placeholder="dela Cruz"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="contactNumber" className="kicker-label block mb-1.5">
                    Contact number
                  </label>
                  <input
                    id="contactNumber"
                    type="tel"
                    autoComplete="tel"
                    required
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                    placeholder="09XX XXX XXXX"
                  />
                </div>

                <div>
                  <span className="kicker-label block mb-2">I am a</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole('passenger')}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-card border text-xs font-display font-bold transition ${
                        role === 'passenger'
                          ? 'border-trike-gold bg-trike-gold/20 text-trust-slate shadow-xs'
                          : 'border-cream-300 bg-cream-100 text-cream-600 hover:border-cream-400'
                      }`}
                    >
                      <Users className="w-5 h-5 text-trust-slate" />
                      Passenger
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('rider')}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-card border text-xs font-display font-bold transition ${
                        role === 'rider'
                          ? 'border-trike-gold bg-trike-gold/20 text-trust-slate shadow-xs'
                          : 'border-cream-300 bg-cream-100 text-cream-600 hover:border-cream-400'
                      }`}
                    >
                      <Bike className="w-5 h-5 text-trust-slate" />
                      Rider
                    </button>
                  </div>
                </div>

                {role === 'rider' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="sex" className="kicker-label block mb-1.5">
                          Sex
                        </label>
                        <select
                          id="sex"
                          required
                          value={sex}
                          onChange={(e) => setSex(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 text-sm font-sans text-trust-slate bg-cream-50 focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
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
                        <label htmlFor="birthdate" className="kicker-label block mb-1.5">
                          Birthdate
                        </label>
                        <input
                          id="birthdate"
                          type="date"
                          required
                          value={birthdate}
                          onChange={(e) => setBirthdate(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="address" className="kicker-label block mb-1.5">
                        Address
                      </label>
                      <input
                        id="address"
                        type="text"
                        autoComplete="street-address"
                        required
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                        placeholder="Purok / Barangay, Dumaguete City"
                      />
                    </div>

                    <div>
                      <label htmlFor="unitNumber" className="kicker-label block mb-1.5">
                        Pedicab Number
                      </label>
                      <input
                        id="unitNumber"
                        type="text"
                        required
                        value={unitNumber}
                        onChange={(e) => setUnitNumber(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                        placeholder="e.g. 0412"
                      />
                    </div>

                    <div>
                      <label htmlFor="vehicleType" className="kicker-label block mb-1.5">
                        Vehicle type
                      </label>
                      <select
                        id="vehicleType"
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 text-sm font-sans text-trust-slate bg-cream-50 focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                      >
                        {VEHICLE_OPTIONS.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <span className="kicker-label block mb-1.5">
                        Profile photo <span className="font-normal lowercase text-cream-500">(optional)</span>
                      </span>
                      <div className="flex items-center gap-3">
                        {photo ? (
                          <img
                            src={photo}
                            alt="Rider preview"
                            className="w-14 h-14 rounded-card object-cover border border-cream-300 shadow-xs"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-card border border-dashed border-cream-300 bg-cream-100 flex items-center justify-center text-cream-400">
                            <Bike className="w-5 h-5" />
                          </div>
                        )}
                        <label className="cursor-pointer px-3.5 py-2 rounded-pill border border-cream-300 bg-cream-50 text-xs font-display font-bold text-trust-slate hover:bg-cream-200 transition shadow-xs">
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
                        <p className="text-xs font-sans font-bold text-sunset-coral mt-1.5">{photoError}</p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            <div>
              <label htmlFor="email" className="kicker-label block mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="kicker-label block mb-1.5">
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
                className="w-full px-3.5 py-2.5 rounded-card border border-cream-300 bg-cream-50 text-sm font-sans text-trust-slate focus:outline-none focus:ring-2 focus:ring-trike-gold focus:border-trike-gold"
                placeholder="At least 8 characters"
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
              className="btn-primary w-full py-3.5 text-sm font-display font-extrabold shadow-md disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in'
                  : 'Create account'}
            </button>
          </form>

          <p className="text-center text-xs font-sans text-cream-600 mt-6 font-medium">
            {mode === 'login' ? (
              <>
                New to GentleTrike?{' '}
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="text-trust-slate font-display font-bold underline hover:text-trike-gold"
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
                  className="text-trust-slate font-display font-bold underline hover:text-trike-gold"
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
