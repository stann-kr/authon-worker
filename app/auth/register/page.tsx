'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Footer from '@/components/Footer';
import Link from 'next/link';
import Icon from '@/components/Icon';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useTranslations } from 'next-intl';

/**
 * Register page is no longer available.
 * User accounts are created by admins (super_admin / venue_admin).
 * This page shows a message and redirects to login after 3 seconds.
 */
export default function RegisterPage() {
  const router = useRouter();
  const t = useTranslations('Auth');

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/auth/login');
    }, 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas">
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="app-panel w-full max-w-sm p-7 text-center sm:p-9">
          <div className="mb-6 flex justify-end">
            <LanguageSwitcher compact />
          </div>
          <div className="mb-8">
            <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-panel border border-border-default bg-surface-raised text-text-muted">
              <Icon name="locked" size={22} />
            </div>

            <h1 className="mb-3 text-xl font-semibold text-text-heading">
              {t('registrationClosed')}
            </h1>
            <p className="text-sm leading-relaxed text-text-muted">
              {t('registrationClosedDescription')}
            </p>
          </div>

          <p className="mb-6 text-xs text-text-dim">
            {t('redirectingInSeconds')}
          </p>
          
          <Link 
            href="/auth/login"
            className="pressable inline-flex min-h-11 w-full items-center justify-center rounded-control bg-action-primary px-4 py-3 text-center text-sm font-semibold text-action-text hover:bg-action-hover"
          >
            {t('goToLogin')}
          </Link>
        </div>
      </div>

      <Footer />
    </div>
  );
}
