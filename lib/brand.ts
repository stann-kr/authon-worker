const DEFAULT_BRAND_NAME = 'Authon';

export const BRAND_NAME =
  process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || DEFAULT_BRAND_NAME;

export const BRAND_TAGLINE =
  process.env.NEXT_PUBLIC_BRAND_TAGLINE?.trim() || 'Guest Management System';

export const BRAND_DESCRIPTION =
  process.env.NEXT_PUBLIC_BRAND_DESCRIPTION?.trim() || `${BRAND_NAME} Guest Management System`;

export const BRAND_FOOTER =
  process.env.NEXT_PUBLIC_BRAND_FOOTER?.trim() || `© ${new Date().getFullYear()} ${BRAND_NAME} By Stann`;
