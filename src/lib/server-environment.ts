const requiredDatabaseVariables = ["DATABASE_URL"] as const;
const requiredSessionVariables = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;
const requiredLoginVariables = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

function assertVariables(names: readonly string[]) {
  const missing = names.filter((name) => !process.env[name]?.trim());

  if (missing.length > 0) {
    throw new Error(`Missing required server environment: ${missing.join(", ")}`);
  }
}

function assertStrongAuthSecret() {
  if ((process.env.BETTER_AUTH_SECRET?.length ?? 0) < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
}

export function assertDatabaseEnvironment() {
  assertVariables(requiredDatabaseVariables);
}

export function assertAuthEnvironment() {
  assertVariables([
    ...requiredDatabaseVariables,
    ...requiredSessionVariables,
    ...requiredLoginVariables,
  ]);
  assertStrongAuthSecret();
}

export function assertSessionEnvironment() {
  assertVariables([...requiredDatabaseVariables, ...requiredSessionVariables]);
  assertStrongAuthSecret();
}
