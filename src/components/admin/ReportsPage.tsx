import React, { useEffect, useState } from 'react';
import * as adminApi from '../../api/adminApi';
import { Filter, CheckCircle2, AlertOctagon, Clock, MessageSquare, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const SEVERITY_COLORS = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  investigating: 'bg-purple-100 text-purple-800 border-purple-200',
  resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export const ReportsPage: React.FC = () => {
  const { user } = useAuth();
  const subRole = user?.sub_role ?? 'super_admin';

  const [reports, setReports] = useState<adminApi.TmoReportItem[]>([]);
  const [stats, setStats] = useState<{ category: string; count: number }[]>([]);
  const [repeatOffenders, setRepeatOffenders] = useState<any[]>([]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');

  // Selected Report Modal / Note editing
  const [selectedReport, setSelectedReport] = useState<adminApi.TmoReportItem | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchReports = () => {
    Promise.all([
      adminApi.getReports({
        category: categoryFilter || undefined,
        status: statusFilter || undefined,
        severity: severityFilter || undefined,
      }),
      adminApi.getReportStats(),
      adminApi.getRepeatOffenders(),
    ])
      .then(([r, s, ro]) => {
        setReports(r);
        setStats(s);
        setRepeatOffenders(ro);
      })
      .catch((err) => console.error(err))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    fetchReports();
  }, [categoryFilter, statusFilter, severityFilter]);

  const handleUpdateReport = async (reportId: string, newStatus?: string, newSeverity?: string) => {
    try {
      const updated = await adminApi.updateReport(reportId, {
        status: newStatus,
        severity: newSeverity,
        adminNotes: adminNotes || undefined,
      });

      setReports(reports.map((r) => (r.id === reportId ? updated : r)));
      if (selectedReport?.id === reportId) {
        setSelectedReport(updated);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to update report status');
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <p className="text-xs font-bold text-gray-500 animate-pulse">Loading TMO reports...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Category Breakdown & Repeat Offenders Header Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Category Breakdown Chart */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4">
          <h3 className="text-base font-black text-gray-900">Complaints by Category</h3>
          <div className="h-52 w-full">
            {stats.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats}>
                  <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8B5CF6" radius={[6, 6, 0, 0]}>
                    {stats.map((_, idx) => (
                      <Cell key={idx} fill={idx % 2 === 0 ? '#8B5CF6' : '#EC4899'} />
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

        {/* Repeat Offenders Card */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-3">
          <div className="flex items-center gap-2 text-red-600">
            <AlertOctagon className="w-5 h-5" />
            <h3 className="text-base font-black text-gray-900">Repeat Offenders</h3>
          </div>
          <p className="text-xs text-gray-500">Drivers with 2 or more filed complaints</p>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {repeatOffenders.map((offender) => (
              <div key={offender.driver_id} className="p-3 bg-red-50/60 rounded-xl border border-red-100 flex items-center justify-between text-xs">
                <div>
                  <h4 className="font-bold text-gray-900">{offender.driver_name}</h4>
                  <p className="text-gray-500 font-medium">{offender.unit_number} · {offender.categories}</p>
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

      {/* Report Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-bold text-gray-900">Filter Reports:</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 outline-none"
          >
            <option value="">All Categories</option>
            <option value="overcharging">Overcharging</option>
            <option value="reckless_driving">Reckless Driving</option>
            <option value="harassment">Harassment</option>
            <option value="rudeness">Rudeness</option>
            <option value="vehicle_condition">Vehicle Condition</option>
            <option value="other">Other</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 outline-none"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>

          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 outline-none"
          >
            <option value="">All Severities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {(categoryFilter || statusFilter || severityFilter) && (
            <button
              onClick={() => {
                setCategoryFilter('');
                setStatusFilter('');
                setSeverityFilter('');
              }}
              className="text-xs text-purple-600 font-bold hover:underline"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Reports Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-600">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
              <tr>
                <th className="px-6 py-4">Ref Code</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4">Driver</th>
                <th className="px-6 py-4">Severity</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 font-mono font-bold text-purple-700">{report.reference_code}</td>
                  <td className="px-6 py-4 capitalize font-bold text-gray-900">{report.violation_type.replace('_', ' ')}</td>
                  <td className="px-6 py-4 font-medium text-gray-600">{report.driver_name ?? 'N/A'}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border capitalize ${SEVERITY_COLORS[report.severity || 'medium']}`}>
                      {report.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border capitalize ${STATUS_COLORS[report.status || 'pending']}`}>
                      {report.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400 font-medium">
                    {new Date(report.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => {
                        setSelectedReport(report);
                        setAdminNotes(report.admin_notes || '');
                      }}
                      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-400 font-medium">
                    No reports match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal */}
      {selectedReport && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-xl overflow-hidden space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-lg font-black text-gray-900">
                Report <span className="font-mono text-purple-600">{selectedReport.reference_code}</span>
              </h3>
              <button onClick={() => setSelectedReport(null)} className="text-gray-400 hover:text-gray-600 font-bold">
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-700">
              <div>
                <span className="font-bold text-gray-500 uppercase">Violation:</span>
                <p className="font-bold text-sm text-gray-900 capitalize">{selectedReport.violation_type.replace('_', ' ')}</p>
              </div>

              <div>
                <span className="font-bold text-gray-500 uppercase">Driver Involved:</span>
                <p className="font-medium text-gray-900">{selectedReport.driver_name ?? 'Unspecified'}</p>
              </div>

              <div>
                <span className="font-bold text-gray-500 uppercase">Complaint Details:</span>
                <p className="p-3 bg-gray-50 rounded-xl border border-gray-200 font-medium text-gray-800 leading-relaxed mt-1">
                  {selectedReport.details ?? 'No description text provided.'}
                </p>
              </div>

              {selectedReport.demanded_fare && (
                <div>
                  <span className="font-bold text-gray-500 uppercase">Demanded Fare:</span>
                  <p className="font-bold text-red-600">₱{selectedReport.demanded_fare}</p>
                </div>
              )}

              {/* Status Workflow Controls */}
              <div className="pt-2 border-t border-gray-100 space-y-2">
                <label className="font-bold text-gray-500 uppercase">Update Status:</label>
                <div className="flex gap-2">
                  {(['pending', 'investigating', 'resolved'] as const).map((st) => {
                    if (st === 'resolved' && subRole === 'staff') {
                      return null; // Enforce super_admin resolution check
                    }
                    return (
                      <button
                        key={st}
                        onClick={() => handleUpdateReport(selectedReport.id, st)}
                        className={`flex-1 py-2 rounded-xl font-bold capitalize transition border ${
                          selectedReport.status === st
                            ? 'bg-purple-600 text-white border-purple-600'
                            : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {st}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Admin Notes */}
              <div className="space-y-1">
                <label className="font-bold text-gray-500 uppercase">TMO Officer Notes:</label>
                <textarea
                  rows={3}
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  placeholder="Record investigation findings or resolution steps..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-purple-500 font-medium"
                />
                <button
                  onClick={() => handleUpdateReport(selectedReport.id, selectedReport.status)}
                  className="w-full py-2 bg-gray-900 text-white font-bold rounded-xl text-xs hover:bg-gray-800 transition"
                >
                  Save Notes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
