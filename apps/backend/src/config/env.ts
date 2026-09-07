function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtRefreshSecret: requireEnv("JWT_REFRESH_SECRET"),
};

if (env.jwtSecret === env.jwtRefreshSecret) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must not be the same value");
}
