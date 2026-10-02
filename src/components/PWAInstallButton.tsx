import React, { useState } from 'react';
import { Download, Smartphone, Share2, PlusSquare, CheckCircle, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  className?: string;
  variant?: 'compact' | 'full' | 'header';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  className = '',
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  // If already installed and running as standalone app, show subtle status badge or nothing
  if (isInstalled) {
    if (variant === 'full') {
      return (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-800 text-xs text-emerald-300 ${className}`}>
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>মোবাইল অ্যাপ হিসেবে সক্রিয় রয়েছে</span>
        </div>
      );
    }
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      setIsInstalling(true);
      try {
        await install();
      } finally {
        setIsInstalling(false);
      }
    } else if (isIOS) {
      setShowIOSModal(true);
    } else {
      // General instructions for browsers where beforeinstallprompt already dismissed
      setShowIOSModal(true);
    }
  };

  return (
    <>
      {variant === 'header' ? (
        <button
          onClick={handleInstallClick}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-900/40 transition-all active:scale-95 cursor-pointer ${className}`}
          title="ফোনে সরাসরি অ্যাপ্লিকেশন হিসেবে ইনস্টল করুন"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">অ্যাপ ডাউনলোড করুন</span>
          <span className="sm:hidden">ইনস্টল</span>
        </button>
      ) : variant === 'full' ? (
        <button
          onClick={handleInstallClick}
          disabled={isInstalling}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold text-sm shadow-lg shadow-emerald-950/50 transition-all active:scale-98 cursor-pointer ${className}`}
        >
          <Download className="w-4 h-4" />
          <span>ফোনে সাবসিঙ্ক অ্যাপ ডাউনলোড/ইনস্টল করুন</span>
        </button>
      ) : (
        <button
          onClick={handleInstallClick}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all cursor-pointer ${className}`}
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
          <span>অ্যাপ ইনস্টল</span>
        </button>
      )}

      {/* iOS / General Browser Guide Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-950/80 border border-emerald-800 rounded-lg">
                  <Smartphone className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">ফোনে অ্যাপ ডাউনলোড করুন</h3>
                  <p className="text-[11px] text-slate-400">হোম স্ক্রিনে সরাসরি অ্যাপের মতো রাখুন</p>
                </div>
              </div>
              <button
                onClick={() => setShowIOSModal(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="w-6 h-6 rounded-full bg-emerald-900 text-emerald-300 font-bold flex items-center justify-center shrink-0 text-xs">
                  ১
                </span>
                <div>
                  <p className="font-semibold text-white">ব্রাউজারের মেনু বা শেয়ার অপশন চাপুন</p>
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                    Safari তে <Share2 className="w-3.5 h-3.5 text-blue-400 inline" /> Share বা Chrome এ ৩-ডট মেনু
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                <span className="w-6 h-6 rounded-full bg-emerald-900 text-emerald-300 font-bold flex items-center justify-center shrink-0 text-xs">
                  ২
                </span>
                <div>
                  <p className="font-semibold text-white">"Add to Home Screen" বা "Install" চাপুন</p>
                  <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                    <PlusSquare className="w-3.5 h-3.5 text-emerald-400 inline" /> হোম স্ক্রিনে অ্যাপ যুক্ত হয়ে যাবে
                  </p>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-900/50 text-[11px] text-emerald-300 leading-relaxed">
                💡 <strong>সুবিধা:</strong> অ্যাপ হিসেবে ইনস্টল করলে ব্রাউজার ফ্রেম ছাড়া ফুলস্ক্রিন অ্যাপের মতো দ্রুত ও সহজে চলবে!
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              বুঝেছি
            </button>
          </div>
        </div>
      )}
    </>
  );
};
