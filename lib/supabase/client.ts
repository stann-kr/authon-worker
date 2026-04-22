import { createBrowserClient } from "@supabase/ssr";
import { Database } from "../database.types";

export const createClient = () => {
  // SSR 환경(빌드 시점)에서는 실제 클라이언트 대신 안전한 Proxy 객체를 반환합니다.
  if (typeof window === "undefined") {
    const mockHandler: ProxyHandler<any> = {
      get: (target, prop) => {
        if (prop === "auth") {
          return {
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({
              data: { subscription: { unsubscribe: () => {} } },
            }),
            getUser: async () => ({ data: { user: null }, error: null }),
            signOut: async () => ({ error: null }),
          };
        }
        if (prop === "functions") {
          return {
            invoke: async () => ({ data: null, error: null }),
          };
        }
        // 체이닝 지원 (from, select, eq, order 등...)
        const chainable = () => new Proxy({}, mockHandler);
        return chainable;
      },
      apply: () => new Proxy({}, mockHandler),
    };
    return new Proxy({}, mockHandler) as any;
  }

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
};
