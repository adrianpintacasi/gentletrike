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
      icon: <ShieldCheck className="w-5 h-5 shrink-0 text-sampaguita-green" />,
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
    <div className="flex min-h-screen w-full bg-cream-100 font-sans text-trust-slate antialiased animate-fadeIn">
      {/* ========================================================================= */}
      {/* MOBILE TOP BAR (< md) */}
      {/* ========================================================================= */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-cream-50 border-b border-cream-300 px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <img
            src="/GentleTrike.png"
            alt="GentleTrike"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
            className="w-9 h-9 object-contain rounded-card border border-cream-300 bg-cream-50 shrink-0"
          />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-display font-black text-trust-slate tracking-tight">GentleTrike</h2>
              <span className="px-2 py-0.5 rounded-pill text-[10px] font-display font-extrabold uppercase tracking-wider bg-trike-gold/20 text-trust-slate border border-trike-gold/40">
                {subRole === 'super_admin' ? 'Super Admin' : 'Staff'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => void logout()}
            className="p-2 rounded-card text-sunset-coral hover:bg-sunset-coral/10 transition"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
          <button
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="p-2 rounded-card text-trust-slate hover:bg-cream-200 transition focus:outline-none"
            aria-label={isMobileOpen ? 'Close Navigation Menu' : 'Open Navigation Menu'}
          >
            {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* MOBILE DRAWER BACKDROP & MENU */}
      {isMobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-trust-slate/60 backdrop-blur-xs transition-opacity"
          onClick={() => setIsMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`md:hidden fixed top-14 left-0 bottom-0 z-50 w-72 bg-cream-50 border-r border-cream-300 shadow-2xl flex flex-col transition-transform duration-300 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Mobile Admin Navigation"
      >
        <div className="p-4 border-b border-cream-300 bg-cream-200/40">
          <p className="kicker-label">Navigation</p>
          <p className="text-[11px] font-sans text-cream-600 mt-0.5">Dumaguete TMO Operations</p>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Mobile Navigation Menu">
          {filteredNavItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-card text-xs font-display font-bold transition-all ${
                  isActive
                    ? 'bg-trust-slate text-cream-50 shadow-sm'
                    : 'text-cream-700 hover:text-trust-slate hover:bg-cream-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-pill font-display font-black ${
                      isActive ? 'bg-trike-gold text-trust-slate' : 'bg-trike-gold/30 text-trust-slate'
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
        className={`hidden md:flex flex-col bg-cream-50 border-r border-cream-300 shrink-0 transition-all duration-300 sticky top-0 h-screen z-20 ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
        aria-label="Desktop Admin Navigation"
      >
        {/* SIDEBAR HEADER BRANDING */}
        <div className="p-4 border-b border-cream-300">
          <div className="flex items-center gap-3 overflow-hidden">
            <img
              src="/GentleTrike.png"
              alt="GentleTrike"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
              className="w-10 h-10 object-contain rounded-card border border-cream-300 bg-cream-50 shrink-0"
            />
            {!isCollapsed && (
              <div className="min-w-0 flex-1 animate-fadeIn">
                <h2 className="text-base font-display font-black text-trust-slate tracking-tight truncate">GentleTrike</h2>
                <p className="text-[11px] font-sans text-cream-600 font-medium truncate leading-tight">
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
                } py-2.5 rounded-card text-xs font-display font-bold transition-all group ${
                  isActive
                    ? 'bg-trust-slate text-cream-50 shadow-sm'
                    : 'text-cream-700 hover:text-trust-slate hover:bg-cream-200'
                }`}
              >
                <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
                  {item.icon}
                  {!isCollapsed && <span className="truncate">{item.label}</span>}
                </div>

                {!isCollapsed && item.badge && (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-pill font-display font-black ${
                      isActive ? 'bg-trike-gold text-trust-slate' : 'bg-trike-gold/30 text-trust-slate'
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
            } py-2.5 rounded-card text-xs font-display font-bold text-sunset-coral hover:bg-sunset-coral/10 transition`}
          >
            <LogOut className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span>Sign out</span>}
          </button>
        </div>

        {/* SIDEBAR FOOTER & COLLAPSE TOGGLE */}
        <div className="p-3 border-t border-cream-300 flex items-center justify-between bg-cream-200/40">
          {!isCollapsed && user && (
            <div className="min-w-0 pr-2 animate-fadeIn">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-display font-bold text-trust-slate truncate">{user.name}</p>
                <span className="shrink-0 px-2 py-0.5 rounded-pill text-[9px] font-display font-extrabold uppercase tracking-wide bg-trike-gold/20 text-trust-slate border border-trike-gold/40">
                  {subRole === 'super_admin' ? 'Super Admin' : 'Staff'}
                </span>
              </div>
              <p className="text-[10px] font-sans text-cream-600 truncate">{user.email}</p>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={`p-2 rounded-card text-cream-600 hover:text-trust-slate hover:bg-cream-50 hover:shadow-xs border border-transparent hover:border-cream-300 transition ${
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

