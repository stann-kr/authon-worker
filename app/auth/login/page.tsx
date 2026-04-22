
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Footer from '@/components/Footer';
import Alert from '@/components/Alert';
import { login } from '@/lib/auth';
import { BRAND_NAME } from '@/lib/brand';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const router = useRouter();
  const supabase = createClient();

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
    } catch (error) {
      setError('An error occurred during login.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetLoading(true);
    setResetMessage('');
    setError('');

    try {
      const redirectUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/auth/reset-password`
        : '';

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: redirectUrl,
      });

      if (resetError) {
        setError(resetError.message);
      } else {
        setResetMessage('Password reset link sent. Please check your email.');
      }
    } catch (err) {
      setError('An error occurred while requesting password reset.');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="bg-gray-900/50 border border-gray-800 p-6 sm:p-8 lg:p-10">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-2 h-2 bg-white"></div>
              <div className="w-2 h-2 bg-white"></div>
              <div className="w-2 h-2 bg-white"></div>
            </div>
            <h1 className="font-mono text-xl sm:text-2xl lg:text-3xl tracking-wider text-white uppercase mb-2">{BRAND_NAME}</h1>
            <p className="text-xs sm:text-sm text-gray-400 tracking-widest font-mono uppercase">
              {showForgotPassword ? 'PASSWORD RESET' : 'USER ACCESS'}
            </p>
          </div>

          {showForgotPassword ? (
            <form onSubmit={handleResetPassword} className="space-y-4 sm:space-y-5">
              <div>
                <label className="block text-gray-400 font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                  EMAIL ADDRESS
                </label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white transition-colors"
                  placeholder="Enter your email"
                  required
                />
              </div>

              {error && (
                <Alert type="error" message={error} />
              )}

              {resetMessage && (
                <Alert type="success" message={resetMessage} />
              )}

              <button
                type="submit"
                disabled={resetLoading}
                className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                {resetLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border border-black border-t-transparent rounded-full animate-spin"></div>
                    <span>SENDING...</span>
                  </div>
                ) : (
                  'SEND RESET LINK'
                )}
              </button>

              <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => { setShowForgotPassword(false); setError(''); setResetMessage(''); }}
                  className="text-gray-400 font-mono text-xs tracking-wider uppercase hover:text-white transition-colors"
                >
                  ← BACK TO LOGIN
                </button>
              </div>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-gray-400 font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                EMAIL ADDRESS
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full bg-gray-900 border border-gray-700 px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white transition-colors"
                placeholder="Enter your email"
                required
              />
            </div>

            <div>
              <label className="block text-gray-400 font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                PASSWORD
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                className="w-full bg-gray-900 border border-gray-700 px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-white transition-colors"
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <Alert type="error" message={error} />
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-white text-black py-3 sm:py-4 font-mono text-sm tracking-wider uppercase hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              {isLoading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border border-black border-t-transparent rounded-full animate-spin"></div>
                  <span>SIGNING IN...</span>
                </div>
              ) : (
                'SIGN IN'
              )}
            </button>

            <div className="text-center mt-2">
              <button
                type="button"
                onClick={() => { setShowForgotPassword(true); setError(''); setResetEmail(formData.email); }}
                className="text-gray-500 font-mono text-xs tracking-wider uppercase hover:text-gray-300 transition-colors"
              >
                FORGOT PASSWORD?
              </button>
            </div>
          </form>
          )}

          <Footer compact />
        </div>
      </div>
    </div>
  );
}
