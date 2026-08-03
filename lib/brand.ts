export interface VenueBrand {
  name: string;
  tagline: string;
  description: string;
  footer: string;
}

const DEFAULT_BRAND_NAME = "Authon";
const DEFAULT_BRAND_TAGLINE = "Guest Management System";

export const PLATFORM_BRAND: VenueBrand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || DEFAULT_BRAND_NAME,
  tagline:
    process.env.NEXT_PUBLIC_BRAND_TAGLINE?.trim() || DEFAULT_BRAND_TAGLINE,
  description:
    process.env.NEXT_PUBLIC_BRAND_DESCRIPTION?.trim() ||
    `${process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || DEFAULT_BRAND_NAME} ${DEFAULT_BRAND_TAGLINE}`,
  footer:
    process.env.NEXT_PUBLIC_BRAND_FOOTER?.trim() ||
    `© ${new Date().getFullYear()} ${process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || DEFAULT_BRAND_NAME} By Stann`,
};

export function createVenueBrand(input: {
  venueName: string;
  brandName?: string | null;
  brandTagline?: string | null;
  brandDescription?: string | null;
  brandFooter?: string | null;
}): VenueBrand {
  const name = input.brandName?.trim() || input.venueName.trim();
  const tagline = input.brandTagline?.trim() || DEFAULT_BRAND_TAGLINE;

  return {
    name,
    tagline,
    description:
      input.brandDescription?.trim() || `${name} ${DEFAULT_BRAND_TAGLINE}`,
    footer:
      input.brandFooter?.trim() ||
      `© ${new Date().getFullYear()} ${name} By Stann`,
  };
}

// Legacy build-time aliases. New request-aware UI should use useVenueBrand().
export const BRAND_NAME = PLATFORM_BRAND.name;
export const BRAND_TAGLINE = PLATFORM_BRAND.tagline;
export const BRAND_DESCRIPTION = PLATFORM_BRAND.description;
export const BRAND_FOOTER = PLATFORM_BRAND.footer;
