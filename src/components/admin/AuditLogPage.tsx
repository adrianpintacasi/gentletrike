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
      <div className="bg-sunset-coral/10 border border-sunset-coral/30 rounded-[28px] p-8 text-center space-y-3 font-sans">
        <Lock className="w-8 h-8 text-sunset-coral mx-auto" />
        <h3 className="text-lg font-display font-black text-trust-slate">Access Restricted</h3>
        <p className="text-xs text-cream-700 font-medium max-w-md mx-auto">
          The Audit Log contains confidential system action history and is strictly accessible to Super Admin officers only. Staff accounts do not have permission to view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn font-sans text-trust-slate">
      {/* Header Info */}
      <div className="bg-trust-slate text-cream-50 rounded-card p-6 shadow-md border border-cream-400/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-white/10 rounded-card text-trike-gold">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-display font-black tracking-tight text-cream-50">System Audit Log</h3>
            <p className="text-xs text-cream-200 font-medium">Read-only record of administrative actions, user creation, and complaint resolutions</p>
          </div>
        </div>
        <span className="px-3.5 py-1.5 bg-trike-gold text-trust-slate text-xs font-display font-black rounded-pill self-start sm:self-auto shadow-2xs">
          Super Admin Mode
        </span>
      </div>

      {/* Audit Log Table */}
      <div className="bg-cream-50 rounded-card border border-cream-300 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-cream-300 bg-cream-100/40 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
          <h4 className="font-display font-bold text-trust-slate text-sm">Action History</h4>
          <input
            type="text"
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            placeholder="Filter by officer name/ID..."
            className="px-3.5 py-1.5 bg-cream-50 border border-cream-300 rounded-pill text-xs font-sans text-trust-slate placeholder:text-cream-400 outline-none focus:ring-2 focus:ring-trike-gold"
          />
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs font-display font-bold text-cream-500 animate-pulse">Loading audit logs...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-cream-700 font-sans">
              <thead className="bg-cream-200/50 border-b border-cream-300 text-xs font-display text-trust-slate uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Officer / Actor</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Target Type</th>
                  <th className="px-6 py-4">Target ID</th>
                  <th className="px-6 py-4">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cream-300/60">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-cream-100/70 transition">
                    <td className="px-6 py-4 text-xs font-medium text-cream-500 whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-bold text-trust-slate">{log.actor_name}</td>
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 rounded-pill text-[11px] font-display font-bold bg-trike-gold/20 text-trust-slate border border-trike-gold/40 uppercase tracking-wider">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 capitalize font-semibold text-trust-slate">{log.target_type}</td>
                    <td className="px-6 py-4 font-mono text-xs text-cream-600">{log.target_id ?? 'N/A'}</td>
                    <td className="px-6 py-4 text-xs text-cream-600 max-w-xs truncate">{log.details ?? '-'}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-cream-400 font-sans font-medium text-xs">
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
