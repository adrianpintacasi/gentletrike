import React, { useEffect, useState } from 'react';
import * as adminApi from '../../api/adminApi';
import { Search, Bike, User as UserIcon, CheckCircle, Clock, ShieldAlert, Star } from 'lucide-react';

export const DirectoryPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'drivers' | 'riders'>('drivers');
  const [drivers, setDrivers] = useState<any[]>([]);
  const [riders, setRiders] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // Profile Modal State
  const [selectedDriver, setSelectedDriver] = useState<any | null>(null);
  const [profileData, setProfileData] = useState<{ rides: any[]; reports: any[] } | null>(null);

  const fetchDirectory = () => {
    setIsLoading(true);
    if (activeSubTab === 'drivers') {
      adminApi
        .getAdminDrivers(search)
        .then(setDrivers)
        .catch((err) => console.error(err))
        .finally(() => setIsLoading(false));
    } else {
      adminApi
        .getAdminRiders(search)
        .then(setRiders)
        .catch((err) => console.error(err))
        .finally(() => setIsLoading(false));
    }
  };

  useEffect(() => {
    fetchDirectory();
  }, [activeSubTab, search]);

  const handleVerifyDriver = async (driverId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'verified' ? 'pending' : 'verified';
    try {
      await adminApi.updateDriverVerification(driverId, nextStatus);
      setDrivers(drivers.map((d) => (d.id === driverId ? { ...d, verification_status: nextStatus } : d)));
    } catch (err: any) {
      alert(err.message || 'Failed to update driver verification');
    }
  };

  const handleOpenProfile = async (driver: any) => {
    setSelectedDriver(driver);
    try {
      const data = await adminApi.getDriverProfile(driver.id);
      setProfileData({ rides: data.rides, reports: data.reports });
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Directory Sub-tab Header & Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-gray-100 p-1 rounded-xl w-full sm:w-auto">
          <button
            onClick={() => setActiveSubTab('drivers')}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition w-1/2 sm:w-auto ${
              activeSubTab === 'drivers' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <Bike className="w-4 h-4 text-amber-500" />
            Pedicab Drivers
          </button>
          <button
            onClick={() => setActiveSubTab('riders')}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition w-1/2 sm:w-auto ${
              activeSubTab === 'riders' ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            <UserIcon className="w-4 h-4 text-blue-500" />
            Passengers
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeSubTab}...`}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs font-bold text-gray-400 animate-pulse">Loading directory...</div>
        ) : activeSubTab === 'drivers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-6 py-4">Driver Name</th>
                  <th className="px-6 py-4">Unit #</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">Rating</th>
                  <th className="px-6 py-4">Trips Completed</th>
                  <th className="px-6 py-4">Verification</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {drivers.map((driver) => (
                  <tr key={driver.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4 font-bold text-gray-900">{driver.name}</td>
                    <td className="px-6 py-4 font-mono text-gray-600">{driver.unit_number}</td>
                    <td className="px-6 py-4 font-medium text-gray-600">{driver.phone}</td>
                    <td className="px-6 py-4 font-bold text-amber-500">★ {driver.rating}</td>
                    <td className="px-6 py-4 font-semibold text-gray-900">{driver.trips_completed}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold capitalize border ${
                          driver.verification_status === 'verified'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                        }`}
                      >
                        {driver.verification_status ?? 'verified'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleVerifyDriver(driver.id, driver.verification_status ?? 'verified')}
                        className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 font-bold text-xs rounded-lg transition"
                      >
                        Toggle Verify
                      </button>
                      <button
                        onClick={() => handleOpenProfile(driver)}
                        className="px-3 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 font-bold text-xs rounded-lg transition"
                      >
                        View Profile
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider font-bold">
                <tr>
                  <th className="px-6 py-4">Passenger Name</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {riders.map((rider) => (
                  <tr key={rider.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-bold text-gray-900">{rider.name}</td>
                    <td className="px-6 py-4 font-medium text-gray-500">{rider.email}</td>
                    <td className="px-6 py-4 text-xs font-medium text-gray-400">
                      {new Date(rider.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Driver Profile Modal */}
      {selectedDriver && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-xl shadow-xl overflow-hidden p-6 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-gray-900">{selectedDriver.name}</h3>
                <p className="text-xs font-bold text-gray-500">Unit: {selectedDriver.unit_number} · Phone: {selectedDriver.phone}</p>
              </div>
              <button onClick={() => setSelectedDriver(null)} className="text-gray-400 hover:text-gray-600 font-bold">
                ✕
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-1">
              <div>
                <h4 className="font-bold text-xs text-gray-500 uppercase tracking-wider mb-2">Complaint History</h4>
                {profileData?.reports.length ? (
                  <div className="space-y-2">
                    {profileData.reports.map((rep) => (
                      <div key={rep.id} className="p-3 bg-red-50 rounded-xl border border-red-100 text-xs">
                        <span className="font-bold text-red-800 capitalize">{rep.violation_type.replace('_', ' ')}</span>
                        <p className="text-gray-700 mt-1">{rep.details}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 font-medium">Clean record — 0 complaints filed.</p>
                )}
              </div>

              <div>
                <h4 className="font-bold text-xs text-gray-500 uppercase tracking-wider mb-2">Recent Ride History</h4>
                {profileData?.rides.length ? (
                  <div className="space-y-2">
                    {profileData.rides.map((r) => (
                      <div key={r.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs flex justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{JSON.parse(r.pickup).name} → {JSON.parse(r.dropoff).name}</p>
                          <p className="text-gray-400">{new Date(r.created_at).toLocaleString()}</p>
                        </div>
                        <span className="font-bold capitalize text-purple-700">{r.status}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 font-medium">No recent ride history found.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
