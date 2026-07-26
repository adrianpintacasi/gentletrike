import React, { useEffect, useState } from 'react';
import * as adminApi from '../../api/adminApi';
import { AlertCircle, XCircle, ShieldAlert, UserX } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export const RejectionsPage: React.FC = () => {
  const [rejections, setRejections] = useState<adminApi.DriverRejection[]>([]);
  const [cancellations, setCancellations] = useState<adminApi.CancellationItem[]>([]);
  const [summary, setSummary] = useState<{ riderInitiated: number; driverInitiated: number }>({
    riderInitiated: 0,
    driverInitiated: 0,
  });
  const [flagged, setFlagged] = useState<adminApi.FlaggedDriver[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      adminApi.getRejections(),
      adminApi.getCancellations(),
      adminApi.getFlaggedDrivers(),
    ])
      .then(([r, c, f]) => {
        setRejections(r);
        setCancellations(c.cancellations);
        setSummary(c.summary);
        setFlagged(f);
      })
      .catch((err) => console.error(err))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <p className="text-xs font-bold text-gray-500 animate-pulse">Loading rejection analytics...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="p-3 bg-red-50 text-red-600 rounded-xl">
            <XCircle className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Driver Rejections</p>
            <h3 className="text-2xl font-black text-gray-900">
              {rejections.reduce((acc, r) => acc + r.rejections_count, 0)}
            </h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <UserX className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Passenger Cancels</p>
            <h3 className="text-2xl font-black text-gray-900">{summary.riderInitiated}</h3>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Flagged High-Risk Drivers</p>
            <h3 className="text-2xl font-black text-gray-900">{flagged.length}</h3>
          </div>
        </div>
      </div>

      {/* Flagged Drivers Section */}
      {flagged.length > 0 && (
        <div className="bg-red-50/50 border border-red-200 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-5 h-5" />
            <h3 className="text-base font-black">Flagged Drivers with Abnormally High Rates</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {flagged.map((driver) => (
              <div key={driver.id} className="bg-white p-4 rounded-xl border border-red-100 shadow-xs space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-gray-900">{driver.name}</h4>
                  <span className="text-xs font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">
                    {driver.unit_number}
                  </span>
                </div>
                <div className="text-xs text-gray-600 space-y-1">
                  <p>Rating: <span className="font-bold text-gray-900">★ {driver.rating}</span></p>
                  <p>Declined Requests: <span className="font-bold text-red-600">{driver.declines_count}</span></p>
                  <p>Cancelled Trips: <span className="font-bold text-red-600">{driver.cancellations_count}</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rejections Bar Chart */}
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
        <div>
          <h3 className="text-base font-black text-gray-900">Driver Rejections Breakdown</h3>
          <p className="text-xs text-gray-500">Frequency of declines per pedicab unit</p>
        </div>

        <div className="h-64 w-full">
          {rejections.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rejections}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="driver_name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="rejections_count" fill="#EF4444" radius={[6, 6, 0, 0]} name="Rejections" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs font-semibold text-gray-400">
              No rejection data recorded yet
            </div>
          )}
        </div>
      </div>

      {/* Rejections Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="font-bold text-gray-900">Rejections Log by Driver</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
              <tr>
                <th className="px-6 py-3">Driver</th>
                <th className="px-6 py-3">Unit #</th>
                <th className="px-6 py-3">Total Rejections</th>
                <th className="px-6 py-3">Sample Reasons</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rejections.map((row) => (
                <tr key={row.driver_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-bold text-gray-900">{row.driver_name}</td>
                  <td className="px-6 py-4 font-medium text-gray-600">{row.unit_number}</td>
                  <td className="px-6 py-4 font-bold text-red-600">{row.rejections_count}</td>
                  <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate">{row.reasons}</td>
                </tr>
              ))}
              {rejections.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-6 text-center text-gray-400 font-medium text-xs">
                    No rejections found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
