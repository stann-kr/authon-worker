import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { instrumentD1 } from "../observability/d1-performance";
import { currentPerformanceTrace } from "../observability/performance-scope";
import * as schema from "./schema";

export function getD1Database() {
  return instrumentD1(getCloudflareContext().env.DB, currentPerformanceTrace());
}

/** getCloudflareContext().env.DB로 Drizzle 인스턴스 반환. */
export function getDb() {
  return drizzle(getD1Database(), { schema });
}
