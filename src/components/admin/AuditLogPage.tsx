import React, { useEffect, useState } from 'react';
import * as adminApi from '../../api/adminApi';
import { ShieldCheck, Lock, Clock, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export const AuditLogPage: React.FC = () => {
  const { user } = useAuth();
  const subRole = user?.sub_role ?? 'super_admin';

  const [logs, setLogs] = useState<adminApi.AuditLogItem[]>([]);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (subRole !== 'super_admin') return;

    setIsLoading(true);
    adminApi
      .getAuditLogs(filterEmployee || undefined)
      .then(setLogs)
      .catch((err) => console.error(err))
      .finally(() => setIsLoading(false));
  }, [subRole, filterEmployee]);

  if (subRole !== 'super_admin') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center space-y-3">
        <Lock className="w-8 h-8 text-red-600 mx-auto" />
        <h3 className="text-lg font-black text-gray-900">Access Restricted</h3>
        <p className="text-xs text-gray-600 font-medium max-w-md mx-auto">
          The Audit Log contains confidential system action history and is strictly accessible to Super Admin officers only. Staff accounts do not have permission to view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Info */}
      <div className="bg-purple-900 text-white rounded-2xl p-6 shadow-md flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-800 rounded-xl">
            <ShieldCheck className="w-6 h-6 text-purple-300" />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-tight">System Audit Log</h3>
            <p className="text-xs text-purple-200 font-medium">Read-only record of administrative actions, user creation, and complaint resolutions</p>
          </div>
        </div>
        <span className="px-3 py-1 bg-purple-800/80 border border-purple-700 text-purple-200 text-xs font-bold rounded-xl">
          Super Admin Mode
        </span>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
          <h4 className="font-bold text-gray-900 text-sm">Action History</h4>
          <input
            type="text"
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            placeholder="Filter by officer name/ID..."
            className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs font-bold text-gray-400 animate-pulse">Loading audit logs...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Officer / Actor</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Target Type</th>
                  <th className="px-6 py-4">Target ID</th>
                  <th className="px-6 py-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 text-xs font-medium text-gray-400 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-bold text-gray-900">{log.actor_name}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200 uppercase tracking-wider">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 capitalize font-semibold text-gray-700">{log.target_type}</td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-500">{log.target_id ?? 'N/A'}</td>
                    <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate">{log.details ?? '-'}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-400 font-medium text-xs">
                      No audit log entries recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
