import React from 'react';
import { Shield, Phone, FileText, X, CheckCircle2 } from 'lucide-react';
import { Portal } from './Portal';

interface SafetyToolkitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenReport?: () => void;
}

export const SafetyToolkitModal: React.FC<SafetyToolkitModalProps> = ({
  isOpen,
  onClose,
  onOpenReport,
}) => {
  if (!isOpen) return null;

  const contacts = [
    {
      name: 'Dumaguete TMO Hotline',
      desc: 'Traffic Management & Public Transport Office',
      phone: '0352251662',
      displayPhone: '(035) 225-1662',
      tag: 'TMO Helpdesk',
      badgeClass: 'bg-trike-gold/20 text-trust-slate border-trike-gold/40',
    },
    {
      name: 'Dumaguete City Police (PNP)',
      desc: 'City Police Station Emergency Assistance',
      phone: '0352251766',
      displayPhone: '911 / (035) 225-1766',
      tag: 'Police Emergency',
      badgeClass: 'bg-sunset-coral/20 text-sunset-coral border-sunset-coral/40',
    },
    {
      name: 'Philippine Red Cross Dumaguete',
      desc: 'Medical & Emergency Ambulance Rescue',
      phone: '0352252835',
      displayPhone: '143 / (035) 225-2835',
      tag: 'Medical / Rescue',
      badgeClass: 'bg-sampaguita-green/20 text-sampaguita-green border-sampaguita-green/40',
    },
  ];

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-trust-slate/60 backdrop-blur-xs transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Modal Card */}
        <div className="relative w-full max-w-md rounded-[24px] border border-cream-300 bg-cream-50 p-5 shadow-2xl gt-rise z-10 text-trust-slate">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-cream-200 pb-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-trust-slate text-trike-gold shadow-xs">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-display font-extrabold text-trust-slate">
                  Safety & Emergency Toolkit
                </h3>
                <p className="text-[11px] font-sans font-medium text-cream-600">
                  Dumaguete City 24/7 Verified Assistance
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close safety modal"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-cream-200 text-trust-slate hover:bg-cream-300 transition active:scale-95"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Contact Numbers List */}
          <div className="space-y-2.5">
            {contacts.map((c) => (
              <div
                key={c.name}
                className="flex items-center justify-between gap-3 rounded-card border border-cream-300 bg-cream-100 p-3 shadow-2xs transition-all hover:border-trike-gold"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-display font-bold text-xs text-trust-slate truncate">
                      {c.name}
                    </span>
                    <span
                      className={`text-[9px] font-display font-bold px-1.5 py-0.2 rounded-pill border ${c.badgeClass}`}
                    >
                      {c.tag}
                    </span>
                  </div>
                  <p className="text-[10px] font-sans text-cream-600 truncate">{c.desc}</p>
                  <p className="text-xs font-mono font-bold text-trust-slate mt-1">
                    {c.displayPhone}
                  </p>
                </div>

                <a
                  href={`tel:${c.phone}`}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-trike-gold text-trust-slate shadow-xs hover:bg-trike-gold-hover transition active:scale-95 font-display font-bold"
                  title={`Call ${c.name}`}
                  aria-label={`Call ${c.name}`}
                >
                  <Phone className="h-4 w-4" />
                </a>
              </div>
            ))}
          </div>

          {/* Action to file a report */}
          {onOpenReport && (
            <div className="mt-4 pt-3 border-t border-cream-200">
              <button
                onClick={() => {
                  onClose();
                  onOpenReport();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-pill bg-cream-200 hover:bg-cream-300 text-trust-slate font-display font-bold text-xs transition active:scale-95 border border-cream-300"
              >
                <FileText className="h-4 w-4 text-trike-gold" />
                <span>File an Official TMO Fare/Safety Report</span>
              </button>
            </div>
          )}

          {/* Location Safety Note */}
          <div className="mt-3 flex items-center gap-2 px-1 text-[10px] font-sans text-cream-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-sampaguita-green shrink-0" />
            <span>Your GPS position is broadcasted to verified Dumaguete TMO dispatch during active trips.</span>
          </div>
        </div>
      </div>
    </Portal>
  );
};
