
'use client';

import Link from 'next/link';
import { logout } from '@/lib/auth';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';

export default function AdminHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-sm border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-3 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
              aria-label={`${BRAND_NAME} Home`}
            >
              <div className="w-2 h-2 bg-white" aria-hidden="true"></div>
              <div>
                <h1 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase">{BRAND_NAME}</h1>
                <p className="text-[10px] sm:text-xs text-gray-400 tracking-widest hidden sm:block">{BRAND_TAGLINE}</p>
              </div>
            </Link>

            <span className="hidden md:inline-block text-gray-700 font-mono">|</span>

            {/* Operational Context Badge */}
            <div className="hidden md:flex items-center gap-2 border border-gray-800 bg-gray-950 px-2.5 py-1 text-[11px] font-mono tracking-wider">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" aria-hidden="true"></span>
              <span className="text-gray-400">CONSOLE:</span>
              <span className="text-white font-bold">ADMIN</span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Navigation Return Button */}
            <Link
              href="/"
              className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-700 bg-gray-900/80 hover:bg-gray-800 hover:border-gray-500 text-gray-300 hover:text-white font-mono text-xs tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
              aria-label="Return to Home Dashboard"
              title="Return to Home (Esc)"
            >
              <i className="ri-home-4-line text-sm" aria-hidden="true"></i>
              <span className="hidden sm:inline">HOME</span>
              <span className="hidden lg:inline-block text-[10px] text-gray-500 border border-gray-700 px-1 py-0.5 rounded ml-0.5">ESC</span>
            </Link>

            {/* Logout Button */}
            <button
              onClick={logout}
              className="w-8 h-8 sm:w-9 sm:h-9 border border-gray-700 bg-black hover:bg-gray-900 hover:border-gray-500 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
              aria-label="Logout of System"
              title="Logout"
            >
              <i className="ri-logout-box-line text-gray-400 text-sm sm:text-base hover:text-white" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
