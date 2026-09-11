function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalJsonEnv(name: string): Record<string, unknown> | undefined {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Environment variable ${name} is not valid JSON`);
  }
}

const googleServiceAccount = optionalJsonEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
const googleDriveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || undefined;

const sumupClientId = process.env.SUMUP_CLIENT_ID || undefined;
const sumupClientSecret = process.env.SUMUP_CLIENT_SECRET || undefined;
const sumupMerchantCode = process.env.SUMUP_MERCHANT_CODE || undefined;

export const env = {
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtRefreshSecret: requireEnv("JWT_REFRESH_SECRET"),
  corsOrigins: requireEnv("CORS_ORIGINS")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Optional: the daily Google Drive audit-log export skips/no-ops (see
  // src/jobs/auditLogExport.ts) instead of failing at boot when these are
  // unset — this deployment's backend must be able to run without a Google
  // service account configured yet.
  googleServiceAccount,
  googleDriveFolderId,
  isGoogleDriveConfigured: Boolean(googleServiceAccount && googleDriveFolderId),
  // Optional, same reasoning as the Google Drive vars above: no real SumUp
  // account exists yet, so the backend must boot without these. POST
  // /me/recharge (src/routes/me.ts) 503s instead of failing at startup when
  // unconfigured — see src/lib/sumup.ts.
  sumupClientId,
  sumupClientSecret,
  sumupMerchantCode,
  isSumUpConfigured: Boolean(sumupClientId && sumupClientSecret && sumupMerchantCode),
};

if (env.jwtSecret === env.jwtRefreshSecret) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET must not be the same value");
}
