const REQUIRED_ENVIRONMENT_NAMES = [
  "AUTHON_PRODUCTION_INTENT",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
];

export function inspectProductionIntent(environment = process.env) {
  const missing = REQUIRED_ENVIRONMENT_NAMES.filter((name) => {
    const value = environment[name];
    if (name === "AUTHON_PRODUCTION_INTENT") return value !== "1";
    return typeof value !== "string" || value.trim().length === 0;
  });
  return { ok: missing.length === 0, missing };
}

function main() {
  const result = inspectProductionIntent();
  if (!result.ok) {
    console.error(
      `Production operation blocked. Set these explicit controls: ${result.missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("Production operation intent verified.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
