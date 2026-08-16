import React, { useCallback, useEffect, useState } from 'react';
import * as adminApi from '../../api/adminApi';
import { listDrivers } from '../../api';
import { RidersLiveMap, RiderPoint } from './RidersLiveMap';
import {
  Users,
  Bike,
  Route,
  FileWarning,
  TrendingUp,
  UserCheck,
  ShieldAlert,
  CalendarClock,
  MapPin,
  AlertOctagon,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';

const COLORS = ['#4C9A6A', '#EF7B5C', '#F0A830', '#123B3D'];
const REFRESH_MS = 15000;

const TONES: Record<string, string> = {
  blue: 'bg-trust-slate/10 text-trust-slate',
  amber: 'bg-trike-gold/20 text-trust-slate',
  emerald: 'bg-sampaguita-green/15 text-sampaguita-green',
  red: 'bg-sunset-coral/15 text-sunset-coral',
  orange: 'bg-sunset-coral/15 text-sunset-coral',
  gray: 'bg-cream-200 text-trust-slate',
};
const RING: Record<string, string> = {
  amber: 'ring-1 ring-trike-gold/40',
  red: 'ring-1 ring-sunset-coral/40',
  orange: 'ring-1 ring-sunset-coral/40',
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: keyof typeof TONES;
  live?: boolean;
  alert?: boolean;
}> = ({ icon, label, value, tone, live, alert }) => (
  <div
    className={`bg-cream-50 p-5 rounded-card border border-cream-300 shadow-sm flex items-center gap-4 ${
      alert && value > 0 ? RING[tone as string] ?? '' : ''
    }`}
  >
    <div className={`p-3 rounded-card ${TONES[tone]}`}>{icon}</div>
    <div>
      <p className="kicker-label flex items-center gap-1.5">
        {label}
        {live && <span className="w-2 h-2 rounded-full bg-sampaguita-green animate-pulse" />}
      </p>
      <h3 className="text-2xl font-display font-black text-trust-slate">{value}</h3>
    </div>
  </div>
);

export const OverviewPage: React.FC = () => {
  const [stats, setStats] = useState<adminApi.OverviewStats | null>(null);
  const [breakdown, setBreakdown] = useState<adminApi.StatusBreakdown[]>([]);
  const [volume, setVolume] = useState<adminApi.VolumeData[]>([]);
  const [categoryStats, setCategoryStats] = useState<{ category: string; count: number }[]>([]);
  const [repeatOffenders, setRepeatOffenders] = useState<any[]>([]);
  const [ridersOnline, setRidersOnline] = useState<RiderPoint[]>([]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [s, b, v, cs, ro, drivers] = await Promise.all([
        adminApi.getOverviewStats(),
        adminApi.getStatusBreakdown(),
        adminApi.getVolumeData(period),
        adminApi.getReportStats(),
        adminApi.getRepeatOffenders(),
        listDrivers(true),
      ]);
      setStats(s);
      setBreakdown(b);
      setVolume(v);
      setCategoryStats(cs);
      setRepeatOffenders(ro);
      setRidersOnline(
        drivers
          .filter((d) => Number.isFinite(d.currentLat) && Number.isFinite(d.currentLng))
          .map((d) => ({ id: d.id, name: d.name, unitNumber: d.unitNumber, lat: d.currentLat, lng: d.currentLng }))
      );
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <p className="text-xs font-display font-bold text-cream-600 animate-pulse">Loading dashboard overview...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Needs-attention cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Bike className="w-6 h-6" />} label="Riders Online" value={stats?.onlineRiders ?? 0} tone="emerald" live />
        <StatCard icon={<UserCheck className="w-6 h-6" />} label="Pending Verifications" value={stats?.pendingVerifications ?? 0} tone="amber" alert />
        <StatCard icon={<FileWarning className="w-6 h-6" />} label="Open Reports" value={stats?.activeReports ?? 0} tone="red" alert />
        <StatCard icon={<ShieldAlert className="w-6 h-6" />} label="Suspended / Banned" value={stats?.suspendedAccounts ?? 0} tone="orange" alert />
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Users className="w-6 h-6" />} label="Total Passengers" value={stats?.totalRiders ?? 0} tone="blue" />
        <StatCard icon={<Bike className="w-6 h-6" />} label="Registered Trikes" value={stats?.totalDrivers ?? 0} tone="amber" />
        <StatCard icon={<Route className="w-6 h-6" />} label="Total Hails" value={stats?.totalRides ?? 0} tone="gray" />
        <StatCard icon={<CalendarClock className="w-6 h-6" />} label="Hails Today" value={stats?.ridesToday ?? 0} tone="emerald" />
      </div>

      {/* Live rider map */}
      <div className="bg-cream-50 p-4 rounded-card border border-cream-300 shadow-sm">
        <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-3">
          <h3 className="text-base font-display font-black text-trust-slate flex items-center gap-2">
            <MapPin className="w-4 h-4 text-trike-gold" />
            Live Rider Locations
            <span className="ml-1 text-xs font-display font-bold text-sampaguita-green">{ridersOnline.length} online</span>
          </h3>
          <div className="flex items-center gap-2 text-[11px] font-display font-bold text-cream-600">
            <span className="w-2 h-2 rounded-full bg-sampaguita-green animate-pulse" />
            Live
            {lastUpdated && (
              <span className="text-cream-500 font-sans font-medium">
                · {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div className="h-[24rem] rounded-card overflow-hidden border border-cream-300 bg-white">
          <RidersLiveMap riders={ridersOnline} />
        </div>
      </div>

      {/* Ride volume + status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-cream-50 p-6 rounded-card border border-cream-300 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-display font-black text-trust-slate flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-trike-gold" />
                Ride Volume Over Time
              </h3>
              <p className="text-xs font-sans text-cream-600">Historical hailing trends in Dumaguete</p>
            </div>
            <div className="flex items-center gap-1 bg-cream-200 p-1 rounded-pill text-xs font-bold border border-cream-300">
              {(['day', 'week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1 rounded-pill capitalize font-display transition ${
                    period === p ? 'bg-cream-50 text-trust-slate shadow-xs' : 'text-cream-600 hover:text-trust-slate'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="h-64 w-full">
            {volume.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={volume}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4DCC8" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#5C5548' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#5C5548' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#FEFEFC', borderColor: '#E4DCC8', borderRadius: '12px' }} />
                  <Line type="monotone" dataKey="rides" stroke="#123B3D" strokeWidth={3} name="Total Rides" />
                  <Line type="monotone" dataKey="completed" stroke="#4C9A6A" strokeWidth={2} name="Completed" />
                  <Line type="monotone" dataKey="cancelled" stroke="#EF7B5C" strokeWidth={2} name="Cancelled" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-sans font-semibold text-cream-500">
                No volume trends available
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-cream-50 p-6 rounded-card border border-cream-300 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="text-base font-display font-black text-trust-slate mb-1">Ride Status Breakdown</h3>
            <p className="text-xs font-sans text-cream-600 mb-4">Completed, cancelled, and active rides</p>
          </div>
          <div className="h-64 w-full">
            {breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={breakdown} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4} dataKey="value">
                    {breakdown.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#FEFEFC', borderColor: '#E4DCC8', borderRadius: '12px' }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-sans font-semibold text-cream-500">
                No ride data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Complaints by category + repeat offenders (moved from TMO Reports) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-cream-50 p-6 rounded-card border border-cream-300 shadow-sm space-y-4">
          <h3 className="text-base font-display font-black text-trust-slate">Complaints by Category</h3>
          <div className="h-52 w-full">
            {categoryStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryStats}>
                  <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#5C5548' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#5C5548' }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#FEFEFC', borderColor: '#E4DCC8', borderRadius: '12px' }} />
                  <Bar dataKey="count" fill="#F0A830" radius={[6, 6, 0, 0]}>
                    {categoryStats.map((_, idx) => (
                      <Cell key={idx} fill={idx % 2 === 0 ? '#F0A830' : '#123B3D'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-sans font-semibold text-cream-500">
                No category data available
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-cream-50 p-6 rounded-card border border-cream-300 shadow-sm space-y-3">
          <div className="flex items-center gap-2 text-sunset-coral">
            <AlertOctagon className="w-5 h-5" />
            <h3 className="text-base font-display font-black text-trust-slate">Repeat Offenders</h3>
          </div>
          <p className="text-xs font-sans text-cream-600">Drivers with 2 or more filed complaints</p>
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {repeatOffenders.map((offender) => (
              <div
                key={offender.driver_id}
                className="p-3 bg-sunset-coral/10 rounded-card border border-sunset-coral/30 flex items-center justify-between text-xs"
              >
                <div>
                  <h4 className="font-display font-bold text-trust-slate">{offender.driver_name}</h4>
                  <p className="text-cream-600 font-sans font-medium">
                    {offender.unit_number} · {offender.categories}
                  </p>
                </div>
                <span className="px-2.5 py-1 bg-sunset-coral text-white font-display font-black rounded-pill">
                  {offender.report_count} reports
                </span>
              </div>
            ))}
            {repeatOffenders.length === 0 && (
              <p className="text-xs text-cream-500 font-sans font-medium py-4 text-center">No repeat offenders detected.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
