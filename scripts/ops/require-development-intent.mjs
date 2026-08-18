const REQUIRED_DEVELOPMENT_INTENT = "AUTHON_DEVELOPMENT_INTENT";

export function inspectDevelopmentIntent(environment = process.env) {
  return {
    ok: environment[REQUIRED_DEVELOPMENT_INTENT] === "1",
    missing:
      environment[REQUIRED_DEVELOPMENT_INTENT] === "1"
        ? []
        : [REQUIRED_DEVELOPMENT_INTENT],
  };
}

function main() {
  const result = inspectDevelopmentIntent();
  if (!result.ok) {
    console.error(
      `Development deploy blocked. Set this explicit control: ${result.missing.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("Development deploy intent verified.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
