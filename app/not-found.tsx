import { BRAND_NAME } from '@/lib/brand';

export default function NotFound() {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-center px-4">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-2 h-2 bg-white"></div>
          <div className="w-2 h-2 bg-white"></div>
          <div className="w-2 h-2 bg-white"></div>
        </div>
        <h1 className="font-mono text-5xl tracking-wider text-white">404</h1>
        <h2 className="font-mono text-lg tracking-wider text-gray-400 uppercase mt-6">PAGE NOT FOUND</h2>
        <p className="mt-4 text-sm text-gray-600 font-mono tracking-wider">{BRAND_NAME}</p>
        <a href="/" className="mt-8 bg-white text-black px-6 py-3 font-mono text-xs tracking-wider uppercase hover:bg-gray-200 transition-colors">
          GO HOME
        </a>
      </div>
    );
  }