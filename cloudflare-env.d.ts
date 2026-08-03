export {};

/**
 * OpenNext uses this global interface for runtime bindings. Public bindings are
 * generated in worker-configuration.d.ts; Dashboard-managed secrets are
 * declared here without values so application code retains a typed boundary.
 */
declare global {
  interface CloudflareEnv {
    DB: D1Database;
    SESSIONS: KVNamespace;
    ASSETS: Fetcher;
    AUTHON_DEPLOYMENT_MODE: "production" | "demo";
    NEXT_PUBLIC_APP_URL: string;
    JWT_SECRET: string;
    TERMINAL_VENUE_ID?: string;
    INTERNAL_API_SECRET?: string;
    AWS_SES_ACCESS_KEY?: string;
    AWS_SES_SECRET_KEY?: string;
    AWS_SES_REGION?: string;
    AWS_SES_FROM_EMAIL?: string;
  }
}
