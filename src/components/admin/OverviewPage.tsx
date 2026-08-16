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

const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6'];
const REFRESH_MS = 15000;

const TONES: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
  orange: 'bg-orange-50 text-orange-600',
  gray: 'bg-gray-100 text-gray-600',
};
const RING: Record<string, string> = {
  amber: 'ring-1 ring-amber-200',
  red: 'ring-1 ring-red-200',
  orange: 'ring-1 ring-orange-200',
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
    className={`bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4 ${
      alert && value > 0 ? RING[tone as string] ?? '' : ''
    }`}
  >
    <div className={`p-3 rounded-xl ${TONES[tone]}`}>{icon}</div>
    <div>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
        {label}
        {live && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
      </p>
      <h3 className="text-2xl font-black text-gray-900">{value}</h3>
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
        <p className="text-xs font-bold text-gray-500 animate-pulse">Loading dashboard overview...</p>
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
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs">
        <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-3">
          <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-600" />
            Live Rider Locations
            <span className="ml-1 text-xs font-bold text-emerald-600">{ridersOnline.length} online</span>
          </h3>
          <div className="flex items-center gap-2 text-[11px] font-bold text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live
            {lastUpdated && (
              <span className="text-gray-400 font-medium">
                · {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div className="h-[24rem] rounded-xl overflow-hidden border border-gray-100">
          <RidersLiveMap riders={ridersOnline} />
        </div>
      </div>

      {/* Ride volume + status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                Ride Volume Over Time
              </h3>
              <p className="text-xs text-gray-500">Historical hailing trends in Dumaguete</p>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl text-xs font-bold">
              {(['day', 'week', 'month'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 rounded-lg capitalize transition ${
                    period === p ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
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
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="rides" stroke="#2563EB" strokeWidth={3} name="Total Rides" />
                  <Line type="monotone" dataKey="completed" stroke="#10B981" strokeWidth={2} name="Completed" />
                  <Line type="monotone" dataKey="cancelled" stroke="#EF4444" strokeWidth={2} name="Cancelled" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-semibold text-gray-400">
                No volume trends available
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-base font-black text-gray-900 mb-1">Ride Status Breakdown</h3>
            <p className="text-xs text-gray-500 mb-4">Completed, cancelled, and active rides</p>
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
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-semibold text-gray-400">
                No ride data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Complaints by category + repeat offenders (moved from TMO Reports) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
          <h3 className="text-base font-black text-gray-900">Complaints by Category</h3>
          <div className="h-52 w-full">
            {categoryStats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryStats}>
                  <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2563EB" radius={[6, 6, 0, 0]}>
                    {categoryStats.map((_, idx) => (
                      <Cell key={idx} fill={idx % 2 === 0 ? '#2563EB' : '#60A5FA'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs font-semibold text-gray-400">
                No category data available
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-red-600">
            <AlertOctagon className="w-5 h-5" />
            <h3 className="text-base font-black text-gray-900">Repeat Offenders</h3>
          </div>
          <p className="text-xs text-gray-500">Drivers with 2 or more filed complaints</p>
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {repeatOffenders.map((offender) => (
              <div
                key={offender.driver_id}
                className="p-3 bg-red-50/60 rounded-xl border border-red-100 flex items-center justify-between text-xs"
              >
                <div>
                  <h4 className="font-bold text-gray-900">{offender.driver_name}</h4>
                  <p className="text-gray-500 font-medium">
                    {offender.unit_number} · {offender.categories}
                  </p>
                </div>
                <span className="px-2.5 py-1 bg-red-600 text-white font-black rounded-lg">
                  {offender.report_count} reports
                </span>
              </div>
            ))}
            {repeatOffenders.length === 0 && (
              <p className="text-xs text-gray-400 font-medium py-4 text-center">No repeat offenders detected.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
