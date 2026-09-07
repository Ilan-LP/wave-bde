function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireJsonEnv(name: string): Record<string, unknown> {
  const raw = requireEnv(name);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Environment variable ${name} is not valid JSON`);
  }
}

export const env = {
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtRefreshSecret: requireEnv("JWT_REFRESH_SECRET"),
  googleServiceAccount: requireJsonEnv("GOOGLE_SERVICE_ACCOUNT_JSON"),
  googleDriveFolderId: requireEnv("GOOGLE_DRIVE_FOLDER_ID"),
};

if (env.jwtSecret === env.jwtRefreshSecret) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must not be the same value");
}
