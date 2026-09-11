process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum-x";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-32-chars-min-x";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "test-service-account@example.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
});
process.env.GOOGLE_DRIVE_FOLDER_ID = "test-drive-folder-id";
process.env.SUMUP_CLIENT_ID = "test-sumup-client-id";
process.env.SUMUP_CLIENT_SECRET = "test-sumup-client-secret";
process.env.SUMUP_MERCHANT_CODE = "test-sumup-merchant-code";
