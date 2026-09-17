import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { PerformanceTrace } from "./performance.ts";

const originalStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();

/** Keeps native statements/receivers intact; neither SQL nor bind values are inspected. */
export function instrumentD1(database: D1Database, trace?: PerformanceTrace): D1Database {
  if (!trace) return database;
  const measure = <R>(task: () => Promise<R>, count: number, hasMetadata = true) => trace.measure("d1", async () => {
    const result = await task();
    if (hasMetadata) trace.recordD1Result(result);
    return result;
  }, count);
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") return (...values: unknown[]) => wrapStatement(target.bind(...values));
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") return value;
        if (["all", "first", "raw", "run"].includes(String(property))) {
          return (...args: unknown[]) => measure(() => Reflect.apply(value, target, args) as Promise<unknown>, 1, property === "all" || property === "run");
        }
        return value.bind(target);
      },
    });
    originalStatements.set(wrapped, statement);
    return wrapped;
  };
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") return (query: string) => wrapStatement(target.prepare(query));
      if (property === "batch") return (statements: D1PreparedStatement[]) =>
        measure(() => target.batch(statements.map((statement) => originalStatements.get(statement) ?? statement)), statements.length);
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
