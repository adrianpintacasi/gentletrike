import React, { useEffect, useState } from 'react';
import * as adminApi from '../../api/adminApi';
import { Users, Bike, Route, AlertTriangle, TrendingUp, Clock } from 'lucide-react';
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
} from 'recharts';

const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6'];

export const OverviewPage: React.FC = () => {
  const [stats, setStats] = useState<adminApi.OverviewStats | null>(null);
  const [breakdown, setBreakdown] = useState<adminApi.StatusBreakdown[]>([]);
  const [volume, setVolume] = useState<adminApi.VolumeData[]>([]);
  const [peakHours, setPeakHours] = useState<adminApi.PeakHourData[]>([]);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('week');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminApi.getOverviewStats(),
      adminApi.getStatusBreakdown(),
      adminApi.getVolumeData(period),
      adminApi.getPeakHours(),
    ])
      .then(([s, b, v, p]) => {
        setStats(s);
        setBreakdown(b);
        setVolume(v);
        setPeakHours(p);
      })
      .catch((err) => console.error(err))
      .finally(() => setIsLoading(false));
  }, [period]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <p className="text-xs font-bold text-gray-500 animate-pulse">Loading dashboard overview...</p>
      </div>
    );
  }

  // Days of week format
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Stat Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Passengers</p>
            <h3 className="text-2xl font-black text-gray-900">{stats?.totalRiders ?? 0}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Bike className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Registered Trikes</p>
            <h3 className="text-2xl font-black text-gray-900">{stats?.totalDrivers ?? 0}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <Route className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Total Hails</p>
            <h3 className="text-2xl font-black text-gray-900">{stats?.totalRides ?? 0}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Active Complaints</p>
            <h3 className="text-2xl font-black text-gray-900">{stats?.activeReports ?? 0}</h3>
          </div>
        </div>
      </div>

      {/* Visualizations Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Ride Status Breakdown (Donut) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-base font-black text-gray-900 mb-1">Ride Status Breakdown</h3>
            <p className="text-xs text-gray-500 mb-4">Proportion of completed, cancelled, and active rides</p>
          </div>
          <div className="h-64 w-full">
            {breakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={4}
                    dataKey="value"
                  >
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

        {/* Ride Volume Over Time (Line Chart) */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-purple-600" />
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
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="rides" stroke="#8B5CF6" strokeWidth={3} name="Total Rides" />
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
      </div>

      {/* Peak Hours Heatmap */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-amber-500" />
          <div>
            <h3 className="text-base font-black text-gray-900">Peak Hours Demand Matrix</h3>
            <p className="text-xs text-gray-500">Distribution of ride requests by day of week and hour of day</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[640px] space-y-1">
            {/* Hour headers */}
            <div className="grid grid-cols-25 gap-1 text-[10px] font-bold text-gray-400 text-center">
              <div></div>
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h}>{h}h</div>
              ))}
            </div>

            {DAYS.map((dayName, dIdx) => (
              <div key={dayName} className="grid grid-cols-25 gap-1 items-center">
                <div className="text-xs font-bold text-gray-600 text-right pr-2">{dayName}</div>
                {Array.from({ length: 24 }).map((_, hIdx) => {
                  const match = peakHours.find((p) => p.day === dIdx && p.hour === hIdx);
                  const count = match?.count ?? 0;

                  let intensityClass = 'bg-gray-50 text-gray-400';
                  if (count > 8) intensityClass = 'bg-purple-600 text-white font-bold';
                  else if (count > 4) intensityClass = 'bg-purple-400 text-white';
                  else if (count > 0) intensityClass = 'bg-purple-100 text-purple-900';

                  return (
                    <div
                      key={hIdx}
                      className={`h-7 rounded-md flex items-center justify-center text-[10px] transition cursor-pointer ${intensityClass}`}
                      title={`${dayName} ${hIdx}:00 — ${count} rides`}
                    >
                      {count > 0 ? count : ''}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
