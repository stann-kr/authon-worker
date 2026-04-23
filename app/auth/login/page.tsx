
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Footer from '@/components/Footer';
import Alert from '@/components/Alert';
import Button from '@/components/Button';
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
    } catch (_error) {
      setError('An error occurred during login.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-sm sm:max-w-md">
        <div className="bg-surface/50 border border-border-subtle p-6 sm:p-8 lg:p-10">
          <div className="text-center mb-8">
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

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                EMAIL ADDRESS
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors"
                placeholder="Enter your email"
                required
              />
            </div>

            <div>
              <label className="block text-text-muted font-mono text-xs sm:text-sm tracking-wider uppercase mb-2">
                PASSWORD
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                className="w-full bg-surface border border-border-default px-4 py-3 sm:py-4 text-white font-mono text-sm tracking-wider focus:outline-none focus:border-border-focus transition-colors"
                placeholder="Enter your password"
                required
              />
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
            
            <div className="text-center mt-4">
              <p className="text-text-dim font-mono text-xs tracking-wider uppercase">
                비밀번호를 분실하신 경우 시스템 관리자에게 문의하세요.
              </p>
            </div>
          </form>

          <Footer compact />
        </div>
      </div>
    </div>
  );
}
