'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Footer from '@/components/Footer';
import Alert from '@/components/Alert';
import Button from '@/components/Button';
import PasswordInput from '@/components/PasswordInput';
import { login } from '@/lib/auth';
import { BRAND_NAME } from '@/lib/brand';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const result = await login(formData.email, formData.password);

      if (result.success) {
        router.push('/');
      } else {
        setError(result.message || 'Login failed.');
      }
    } catch {
      setError('An error occurred during login.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="bg-surface/60 border border-border-subtle p-6 sm:p-8 lg:p-10 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="text-center mb-8 sm:mb-9">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-2 h-2 bg-white"></div>
              <div className="w-2 h-2 bg-white"></div>
              <div className="w-2 h-2 bg-white"></div>
            </div>
            <h1 className="font-mono text-xl sm:text-2xl lg:text-3xl tracking-wider text-white uppercase mb-2">{BRAND_NAME}</h1>
            <p className="text-xs sm:text-sm text-gray-400 tracking-widest font-mono uppercase">
              USER ACCESS
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6" aria-busy={isLoading}>
            <div>
              <label
                htmlFor="email"
                className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase mb-2"
              >
                EMAIL ADDRESS
              </label>
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="name@example.com"
                autoComplete="email"
                required
                disabled={isLoading}
                aria-describedby="email-helper"
                aria-invalid={error ? 'true' : 'false'}
              />
              <p id="email-helper" className="text-text-dim font-mono text-[10px] tracking-[0.22em] uppercase mt-2 leading-relaxed">
                Use the email address registered to your account.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="password"
                  className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase"
                >
                  PASSWORD
                </label>
                <Link
                  href="/auth/reset-password"
                  className="inline-flex items-center gap-1 text-[10px] sm:text-xs text-white font-mono tracking-[0.22em] uppercase hover:text-gray-300 transition-colors"
                  aria-label="Forgot password? Go to password reset page"
                >
                  FORGOT?
                  <i className="ri-arrow-right-up-line text-xs"></i>
                </Link>
              </div>
              <PasswordInput
                id="password"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                inputClassName="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 pr-12 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={isLoading}
                aria-describedby="password-helper password-support"
                aria-invalid={error ? 'true' : 'false'}
              />
              <p id="password-helper" className="text-text-dim font-mono text-[10px] tracking-[0.22em] uppercase leading-relaxed">
                Case-sensitive. Use show/hide if you want to verify what you typed.
              </p>
            </div>

            {error && (
              <Alert type="error" message={error} />
            )}

            <Button
              type="submit"
              isLoading={isLoading}
              fullWidth
              size="lg"
            >
              SIGN IN
            </Button>

            <div className="border border-white/10 bg-black/30 px-4 py-3 space-y-1.5">
              <p className="text-white font-mono text-[10px] tracking-[0.22em] uppercase">
                Need account recovery?
              </p>
              <p id="password-support" className="text-text-dim font-mono text-[10px] tracking-[0.18em] uppercase leading-relaxed">
                We only send reset links to registered email addresses. If you cannot access that inbox, contact your administrator.
              </p>
            </div>
          </form>

          <Footer compact />
        </div>
      </div>
    </div>
  );
}
