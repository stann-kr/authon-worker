import Link from 'next/link';
import { BRAND_NAME } from '@/lib/brand';
import Button from '@/components/Button';

export default function NotFound() {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-center px-4">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-2 h-2 bg-white"></div>
          <div className="w-2 h-2 bg-white"></div>
          <div className="w-2 h-2 bg-white"></div>
        </div>
        <h1 className="font-mono text-5xl tracking-wider text-white">404</h1>
        <h2 className="font-mono text-lg tracking-wider text-text-muted uppercase mt-6">PAGE NOT FOUND</h2>
        <p className="mt-4 text-sm text-text-dim font-mono tracking-wider">{BRAND_NAME}</p>
        
        <div className="mt-8 w-full max-w-xs mx-auto">
          <Link href="/" passHref>
            <Button fullWidth size="lg">
              GO HOME
            </Button>
          </Link>
        </div>
      </div>
    );
  }