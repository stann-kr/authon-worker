import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './lib/db/schema.ts',
  // Applied manual D1 SQL is authoritative. Generator output is disposable review material.
  out: './.docs/generated-migrations',
  dialect: 'sqlite',
});
