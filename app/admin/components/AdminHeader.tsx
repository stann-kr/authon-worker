
'use client';

import Link from 'next/link';
import { logout } from '@/lib/auth';
import { BRAND_NAME, BRAND_TAGLINE } from '@/lib/brand';

export default function AdminHeader() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-gray-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-4">
        <div className="flex items-center justify-between">
          <Link 
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="w-2 h-2 bg-white"></div>
            <div>
              <h1 className="font-mono text-base sm:text-lg tracking-wider text-white uppercase">{BRAND_NAME}</h1>
              <p className="text-xs text-gray-400 tracking-widest hidden sm:block">{BRAND_TAGLINE}</p>
            </div>
          </Link>
          
          <button 
            onClick={logout}
            className="w-8 h-8 sm:w-10 sm:h-10 border border-gray-600 bg-black hover:bg-gray-900 transition-colors flex items-center justify-center"
          >
            <i className="ri-logout-box-line text-gray-400 text-sm sm:text-base"></i>
          </button>
        </div>
      </div>
    </div>
  );
}
