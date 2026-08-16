import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import * as adminApi from '../../api/adminApi';
import { Filter, Printer, X, User, Bike, FileText, ClipboardCheck } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  investigating: 'bg-blue-100 text-blue-800 border-blue-200',
  resolved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

/** A pickup/dropoff is stored as a JSON string on the ride — pull out its name. */
function locationName(json: string | null): string {
  if (!json) return '—';
  try {
    const o = JSON.parse(json);
    return o?.name || o?.address || '—';
  } catch {
    return '—';
  }
}

/** created_at is a UTC timestamp like "2026-07-27 17:23:19" — show it in local time. */
function formatDateTime(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });
}

const prettyViolation = (v: string) => v.replace(/_/g, ' ');

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-1.5 text-gray-500 mb-1.5">
    <span className="text-gray-400">{icon}</span>
    <h4 className="text-[11px] font-black uppercase tracking-wider">{children}</h4>
  </div>
);

/** Inline "LABEL:  value" field with clear spacing between label and value. */
const Field: React.FC<{ label: string; value?: React.ReactNode; full?: boolean }> = ({ label, value, full }) => (
  <div className={`text-sm ${full ? 'col-span-2' : ''}`}>
    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">{label}:</span>
    <span className="ml-2 font-semibold text-gray-900 break-words">{value ?? '—'}</span>
  </div>
);

/** Open a clean, print-ready version of a report in a new window and print it. */
function printReport(r: adminApi.TmoReportItem) {
  const win = window.open('', '_blank', 'width=820,height=920');
  if (!win) {
    alert('Please allow pop-ups for this site to print the report.');
    return;
  }
  const esc = (v: unknown) =>
    String(v ?? '—').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
  const route = `${locationName(r.ride_pickup)} &rarr; ${locationName(r.ride_dropoff)}`;
  const distance = r.ride_distance != null ? `${r.ride_distance} km` : '—';
  const fare = r.demanded_fare != null ? `PHP ${r.demanded_fare}` : '—';

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(
    r.reference_code
  )}</title><style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; margin: 40px; font-size: 13px; }
    .head { border-bottom: 3px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 4px; }
    .org { font-size: 16px; font-weight: 800; color: #1e3a8a; letter-spacing: .3px; }
    .sub { font-size: 11px; color: #6b7280; }
    .title { text-align: center; font-size: 15px; font-weight: 800; letter-spacing: 2px; margin: 18px 0 4px; }
    .ref { text-align: center; font-size: 12px; color: #374151; margin-bottom: 18px; }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #1e3a8a;
         border-bottom: 1px solid #d1d5db; padding-bottom: 4px; margin: 20px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 5px 6px; vertical-align: top; }
    td.k { width: 170px; color: #6b7280; font-weight: 700; text-transform: uppercase; font-size: 10.5px; }
    td.v { font-weight: 600; }
    .viol { color: #dc2626; font-weight: 800; text-transform: capitalize; }
    .box { border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 12px; min-height: 54px; }
    .sign { margin-top: 46px; display: flex; justify-content: space-between; }
    .sign div { width: 45%; border-top: 1px solid #9ca3af; padding-top: 4px; text-align: center;
                font-size: 11px; color: #6b7280; }
    .foot { margin-top: 30px; font-size: 10px; color: #9ca3af; text-align: center; }
    @media print { body { margin: 20px; } }
  </style></head><body>
    <div class="head">
      <div class="org">Dumaguete Traffic Management Office</div>
      <div class="sub">City Ordinance Enforcement Division &bull; GentleTrike Complaint System</div>
    </div>
    <div class="title">OFFICIAL COMPLAINT REPORT</div>
    <div class="ref">Reference No. <strong>${esc(r.reference_code)}</strong> &nbsp;|&nbsp; Filed: ${esc(
    formatDateTime(r.created_at)
  )} &nbsp;|&nbsp; Status: ${esc((r.status || 'pending').toUpperCase())}</div>

    <h2>Complainant (Passenger)</h2>
    <table>
      <tr><td class="k">Name</td><td class="v">${esc(r.complainant_name || 'Anonymous')}</td></tr>
      <tr><td class="k">Contact Number</td><td class="v">${esc(
        r.contact_number || r.complainant_contact
      )}</td></tr>
    </table>

    <h2>Respondent (Driver)</h2>
    <table>
      <tr><td class="k">Name</td><td class="v">${esc(r.driver_name || 'Unidentified')}</td></tr>
      <tr><td class="k">Unit Number</td><td class="v">${esc(r.driver_unit)}</td></tr>
    </table>

    <h2>Incident Details</h2>
    <table>
      <tr><td class="k">Violation</td><td class="v viol">${esc(prettyViolation(r.violation_type))}</td></tr>
      <tr><td class="k">Route</td><td class="v">${route}</td></tr>
      <tr><td class="k">Distance</td><td class="v">${esc(distance)}</td></tr>
      <tr><td class="k">Demanded Fare</td><td class="v">${esc(fare)}</td></tr>
    </table>

    <h2>Complaint Narrative</h2>
    <div class="box">${esc(r.details || 'No description provided.')}</div>

    <h2>TMO Officer Findings</h2>
    <div class="box">${esc(r.admin_notes || 'No findings recorded.')}</div>

    <div class="sign">
      <div>Complainant Signature</div>
      <div>TMO Officer / Investigator</div>
    </div>
    <div class="foot">This document was generated by the GentleTrike TMO Complaint System.</div>
    <script>window.onload = function(){ window.print(); }</script>
  </body></html>`);
  win.document.close();
}

export const ReportsPage: React.FC = () => {
  const [reports, setReports] = useState<adminApi.TmoReportItem[]>([]);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [refFilter, setRefFilter] = useState('');

  // Selected Report Modal / Note editing
  const [selectedReport, setSelectedReport] = useState<adminApi.TmoReportItem | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Anchor the review modal over the content panel (not the whole screen).
  const [contentBox, setContentBox] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);
  useEffect(() => {
    if (!selectedReport) return;
    const measure = () => {
      const el = document.getElementById('admin-main');
      if (!el) return setContentBox(null);
      const r = el.getBoundingClientRect();
      // Clamp to the visible viewport — the content panel can be taller than the
      // window, and an overlay taller than the screen would push the modal out
      // of reach with nothing to scroll.
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      setContentBox({ left: r.left, top, width: r.width, height: Math.max(0, bottom - top) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [selectedReport]);

  const fetchReports = useCallback(() => {
    adminApi
      .getReports({ category: categoryFilter || undefined, status: statusFilter || undefined })
      .then(setReports)
      .catch((err) => console.error(err))
      .finally(() => setIsLoading(false));
  }, [categoryFilter, statusFilter]);

  // Initial load + live auto-refresh.
  useEffect(() => {
    fetchReports();
    const id = setInterval(fetchReports, 15000);
    return () => clearInterval(id);
  }, [fetchReports]);

  const handleUpdateReport = async (reportId: string, newStatus?: string) => {
    try {
      const updated = await adminApi.updateReport(reportId, {
        status: newStatus,
        adminNotes: adminNotes || undefined,
      });
      setReports(reports.map((r) => (r.id === reportId ? updated : r)));
      if (selectedReport?.id === reportId) setSelectedReport(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to update report status');
    }
  };

  const hasFilters = !!(categoryFilter || statusFilter || refFilter);
  const visibleReports = refFilter
    ? reports.filter((r) => r.reference_code.toLowerCase().includes(refFilter.toLowerCase()))
    : reports;

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-12">
        <p className="text-xs font-bold text-gray-500 animate-pulse">Loading TMO reports...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Report Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-xs font-bold text-gray-900">Filter Reports:</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={refFilter}
            onChange={(e) => setRefFilter(e.target.value)}
            placeholder="Ref code"
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-medium text-gray-700 outline-none focus:ring-2 focus:ring-blue-500 w-36"
          />

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-700 outline-none"
          >
            <option value="">All Categories</option>
            <option value="overcharging">Overcharging</option>
            <option value="reckless">Reckless Driving</option>
            <option value="harassment">Harassment</option>
            <option value="refusal">Refusal of Service</option>
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

          {/* Reset sits to the right of the dropdowns and is always visible */}
          <button
            onClick={() => {
              setCategoryFilter('');
              setStatusFilter('');
              setRefFilter('');
            }}
            disabled={!hasFilters}
            className="px-3 py-1.5 rounded-xl text-xs font-bold border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset
          </button>
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
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleReports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 font-mono font-bold text-blue-700">{report.reference_code}</td>
                  <td className="px-6 py-4 capitalize font-bold text-gray-900">
                    {prettyViolation(report.violation_type)}
                  </td>
                  <td className="px-6 py-4 font-medium text-gray-600">{report.driver_name ?? 'N/A'}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold border capitalize ${
                        STATUS_COLORS[report.status || 'pending']
                      }`}
                    >
                      {report.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-400 font-medium">
                    {new Date(report.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => printReport(report)}
                        title="Print report"
                        className="p-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => {
                          setSelectedReport(report);
                          setAdminNotes(report.admin_notes || '');
                        }}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-xl transition"
                      >
                        Review
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleReports.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-400 font-medium">
                    No reports match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review Modal — compact professional report, scoped to the content panel */}
      {selectedReport &&
        createPortal(
          <div
            className="fixed z-50 bg-slate-900/30 overflow-y-auto"
            style={
              contentBox
                ? { left: contentBox.left, top: contentBox.top, width: contentBox.width, height: contentBox.height }
                : { inset: 0 }
            }
            onClick={() => setSelectedReport(null)}
          >
            {/* The whole modal scrolls within this overlay (header included). */}
            <div className="flex min-h-full items-center justify-center p-4">
              <div
                className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-scaleUp"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Official header */}
                <div className="px-6 py-4 border-b-2 border-blue-800">
                  <div className="flex justify-end -mr-2 -mt-1 mb-1">
                    <button
                      onClick={() => setSelectedReport(null)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Row 1: office (left) · date/time (right) */}
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-lg font-black text-gray-900 leading-tight">
                      Dumaguete Traffic Management Office
                    </p>
                    <p className="text-sm font-bold text-gray-800 text-right shrink-0">
                      {formatDateTime(selectedReport.created_at)}
                    </p>
                  </div>
                  {/* Row 2: reference code (left) · status (right) */}
                  <div className="flex items-center justify-between gap-4 mt-1.5">
                    <p className="text-lg font-mono font-bold text-blue-700">{selectedReport.reference_code}</p>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border capitalize ${
                        STATUS_COLORS[selectedReport.status || 'pending']
                      }`}
                    >
                      {selectedReport.status}
                    </span>
                  </div>
                </div>

                {/* Report body */}
                <div className="px-6 py-4 space-y-4">
                {/* Complainant + Respondent side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-200 p-3">
                    <SectionTitle icon={<User className="w-3.5 h-3.5" />}>Complainant (Passenger)</SectionTitle>
                    <div className="space-y-1">
                      <Field label="Name" value={selectedReport.complainant_name || 'Anonymous'} />
                      <Field
                        label="Contact"
                        value={selectedReport.contact_number || selectedReport.complainant_contact}
                      />
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3">
                    <SectionTitle icon={<Bike className="w-3.5 h-3.5" />}>Respondent (Driver)</SectionTitle>
                    <div className="space-y-1">
                      <Field label="Name" value={selectedReport.driver_name || 'Unidentified'} />
                      <Field label="Unit" value={selectedReport.driver_unit} />
                    </div>
                  </div>
                </div>

                {/* Incident — violation highlighted, compact grid */}
                <div className="rounded-xl border border-gray-200 p-3">
                  <SectionTitle icon={<FileText className="w-3.5 h-3.5" />}>Incident Details</SectionTitle>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <Field
                      label="Violation"
                      value={
                        <span className="text-red-600 font-black capitalize">
                          {prettyViolation(selectedReport.violation_type)}
                        </span>
                      }
                    />
                    <Field
                      label="Distance"
                      value={selectedReport.ride_distance != null ? `${selectedReport.ride_distance} km` : '—'}
                    />
                    <Field
                      label="Route"
                      full
                      value={`${locationName(selectedReport.ride_pickup)} → ${locationName(
                        selectedReport.ride_dropoff
                      )}`}
                    />
                    {selectedReport.demanded_fare != null && (
                      <Field
                        label="Demanded Fare"
                        value={<span className="text-red-600 font-bold">₱{selectedReport.demanded_fare}</span>}
                      />
                    )}
                  </div>
                </div>

                {/* Narrative */}
                <div>
                  <SectionTitle icon={<FileText className="w-3.5 h-3.5" />}>Complaint Narrative</SectionTitle>
                  <p className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-sm font-medium text-gray-800 leading-relaxed">
                    {selectedReport.details || 'No description provided.'}
                  </p>
                </div>

                {/* Officer action — a resolved report is closed (read-only) */}
                <div className="pt-3 border-t border-gray-200">
                  <SectionTitle icon={<ClipboardCheck className="w-3.5 h-3.5" />}>TMO Officer Action</SectionTitle>

                  {selectedReport.status === 'resolved' ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 space-y-1">
                      <p className="text-xs font-bold text-emerald-800">
                        ✓ This report has been resolved — no further action needed.
                      </p>
                      {selectedReport.admin_notes && (
                        <p className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                          <span className="font-bold">Notes:</span> {selectedReport.admin_notes}
                        </p>
                      )}
                      {selectedReport.resolved_by && (
                        <p className="text-[11px] text-gray-500">
                          Resolved by {selectedReport.resolved_by}
                          {selectedReport.resolved_at ? ` · ${formatDateTime(selectedReport.resolved_at)}` : ''}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2 mb-3">
                        {(['pending', 'investigating', 'resolved'] as const).map((st) => (
                          <button
                            key={st}
                            onClick={() => handleUpdateReport(selectedReport.id, st)}
                            className={`flex-1 py-2 rounded-xl font-bold capitalize text-xs transition border ${
                              selectedReport.status === st
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>

                      <textarea
                        rows={2}
                        value={adminNotes}
                        onChange={(e) => setAdminNotes(e.target.value)}
                        placeholder="Officer findings / resolution notes..."
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                      />
                      <button
                        onClick={() => handleUpdateReport(selectedReport.id, selectedReport.status)}
                        className="w-full mt-2 py-2 bg-gray-900 text-white font-bold rounded-xl text-xs hover:bg-gray-800 transition"
                      >
                        Save Notes
                      </button>
                    </>
                  )}
                </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
