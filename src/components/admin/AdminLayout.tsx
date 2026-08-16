import React, { useState } from 'react';
import {
  LayoutDashboard,
  FileText,
  Users,
  ShieldCheck,
  UserCog,
  Inbox,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export type AdminTab =
  | 'overview'
  | 'reports'
  | 'directory'
  | 'activation'
  | 'audit'
  | 'users';

interface AdminLayoutProps {
  activeTab: AdminTab;
  onSelectTab: (tab: AdminTab) => void;
  pendingActivations?: number;
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  activeTab,
  onSelectTab,
  pendingActivations = 0,
  children,
}) => {
  const { user, logout } = useAuth();
  const subRole = user?.sub_role ?? 'super_admin';

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const navItems: {
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    superOnly?: boolean;
    badge?: string;
  }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-5 h-5 shrink-0" /> },
    { id: 'reports', label: 'TMO Reports', icon: <FileText className="w-5 h-5 shrink-0" /> },
    { id: 'directory', label: 'User Management', icon: <Users className="w-5 h-5 shrink-0" /> },
    {
      id: 'activation',
      label: 'Activation Requests',
      icon: <Inbox className="w-5 h-5 shrink-0" />,
      badge: pendingActivations > 0 ? String(pendingActivations) : undefined,
    },
    { id: 'users', label: 'TMO Personnel', icon: <UserCog className="w-5 h-5 shrink-0" /> },
    {
      id: 'audit',
      label: 'Audit Log',
      icon: <ShieldCheck className="w-5 h-5 shrink-0 text-blue-400" />,
      superOnly: true,
    },
  ];

  const filteredNavItems = navItems.filter(
    (item) => !item.superOnly || subRole === 'super_admin'
  );

  const handleNavClick = (tabId: AdminTab) => {
    onSelectTab(tabId);
    setIsMobileOpen(false);
  };

  return (
    <div className="flex min-h-screen w-full bg-gray-50/50 font-sans antialiased animate-fadeIn">
      {/* ========================================================================= */}
      {/* MOBILE TOP BAR (< md) */}
      {/* ========================================================================= */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <img
            src="/GentleTrike.png"
            alt="GentleTrike"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            className="w-9 h-9 object-contain rounded-xl border border-amber-200 bg-white shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-gray-900 tracking-tight">GentleTrike</h2>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${
                  subRole === 'super_admin'
                    ? 'bg-blue-100 text-blue-800 border border-blue-200'
                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                }`}
              >
                {subRole === 'super_admin' ? 'Super Admin' : 'Staff'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => void logout()}
            className="p-2 rounded-xl text-gray-600 hover:text-red-600 hover:bg-red-50 transition"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="p-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label={isMobileOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          >
            {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* MOBILE DRAWER BACKDROP & MENU */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-xs transition-opacity"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`md:hidden fixed top-14 left-0 bottom-0 z-50 w-72 bg-white border-r border-gray-200 shadow-2xl flex flex-col transition-transform duration-300 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Mobile Admin Navigation"
      >
        <div className="p-4 border-b border-gray-100 bg-blue-50/50">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Navigation</p>
          <p className="text-[11px] text-gray-400 mt-0.5">Dumaguete TMO Operations</p>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Mobile Navigation Menu">
          {filteredNavItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                }`}
              >
                <div className="flex items-center gap-3">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                      isActive ? 'bg-amber-400 text-blue-950' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ========================================================================= */}
      {/* DESKTOP PERSISTENT LEFT SIDEBAR (>= md) */}
      {/* ========================================================================= */}
      <aside
        className={`hidden md:flex flex-col bg-white border-r border-gray-200 shrink-0 transition-all duration-300 sticky top-0 h-screen z-20 ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
        aria-label="Desktop Admin Navigation"
      >
        {/* SIDEBAR HEADER BRANDING */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3 overflow-hidden">
            <img
              src="/GentleTrike.png"
              alt="GentleTrike"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
              className="w-10 h-10 object-contain rounded-xl border border-amber-200 bg-white shrink-0"
            />
            {!isCollapsed && (
              <div className="min-w-0 flex-1 animate-fadeIn">
                <h2 className="text-base font-black text-gray-900 tracking-tight truncate">GentleTrike</h2>
                <p className="text-[11px] text-gray-500 font-medium truncate leading-tight">
                  Management Portal
                </p>
              </div>
            )}
          </div>
        </div>

        {/* NAVIGATION ITEMS LIST */}
        <nav className="flex-1 p-3 space-y-1.5 overflow-y-auto" aria-label="Admin Navigation Tabs">
          {filteredNavItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                title={isCollapsed ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center ${
                  isCollapsed ? 'justify-center px-2' : 'justify-between px-3.5'
                } py-2.5 rounded-xl text-xs font-bold transition-all focus:outline-hidden focus:ring-2 focus:ring-blue-500 group ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                }`}
              >
                <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
                  {item.icon}
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </div>

                {!isCollapsed && item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                      isActive ? 'bg-amber-400 text-blue-950' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* SIGN OUT */}
        <div className="px-3 pt-2">
          <button
            onClick={() => void logout()}
            title="Sign out"
            className={`w-full flex items-center ${
              isCollapsed ? 'justify-center px-2' : 'gap-3 px-3.5'
            } py-2.5 rounded-xl text-xs font-bold text-gray-600 hover:text-red-600 hover:bg-red-50 transition`}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span>Sign out</span>}
          </button>
        </div>

        {/* SIDEBAR FOOTER & COLLAPSE TOGGLE */}
        <div className="p-3 border-t border-gray-100 flex items-center justify-between bg-gray-50/50">
          {!isCollapsed && user && (
            <div className="min-w-0 pr-2 animate-fadeIn">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-bold text-gray-900 truncate">{user.name}</p>
                <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-blue-100 text-blue-800 border border-blue-200">
                  {subRole === 'super_admin' ? 'Super Admin' : 'Staff'}
                </span>
              </div>
              <p className="text-[10px] text-gray-500 truncate">{user.email}</p>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`p-2 rounded-xl text-gray-500 hover:text-gray-900 hover:bg-white hover:shadow-xs border border-transparent hover:border-gray-200 transition ${
              isCollapsed ? 'w-full flex justify-center' : ''
            }`}
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* MAIN CONTENT AREA */}
      {/* ========================================================================= */}
      <main id="admin-main" className="flex-1 min-w-0 p-4 md:p-6 mt-14 md:mt-0 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-6">{children}</div>
      </main>
    </div>
  );
};

