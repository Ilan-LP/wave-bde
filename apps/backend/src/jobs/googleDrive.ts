import { JWT } from "google-auth-library";
import { env } from "../config/env.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
// Arbitrary fixed boundary: the request body is JSON we build ourselves, so
// it can never contain this exact delimiter and cause the multipart parse
// to break early.
const MULTIPART_BOUNDARY = "wave-bde-audit-export";

function getServiceAccountCredentials(): { clientEmail: string; privateKey: string } {
  if (!env.googleServiceAccount) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  }
  const { client_email: clientEmail, private_key: privateKey } = env.googleServiceAccount;
  if (typeof clientEmail !== "string" || typeof privateKey !== "string") {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing required fields client_email/private_key");
  }
  return { clientEmail, privateKey };
}

function getAuthClient(): JWT {
  const { clientEmail, privateKey } = getServiceAccountCredentials();
  return new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [DRIVE_SCOPE],
  });
}

/**
 * Uploads one JSON file to the Drive folder configured via
 * GOOGLE_DRIVE_FOLDER_ID, via a direct multipart/related upload to the
 * Drive v3 REST API. Only google-auth-library is used (to mint the
 * service-account bearer token) — the upload itself is a plain fetch call,
 * rather than pulling in the `googleapis` meta-package (which bundles
 * generated clients for hundreds of unrelated Google APIs) for what is a
 * single, simple HTTP request. The folder must already be shared with the
 * service account's client_email (service accounts have no meaningful
 * personal Drive storage quota of their own).
 */
export async function uploadJsonExport(filename: string, data: unknown): Promise<void> {
  const auth = getAuthClient();
  const { token } = await auth.getAccessToken();
  if (!token) {
    throw new Error("failed to obtain a Google access token for the Drive upload");
  }

  const metadata = { name: filename, parents: [env.googleDriveFolderId] };
  const body =
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${MULTIPART_BOUNDARY}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${JSON.stringify(data)}\r\n` +
    `--${MULTIPART_BOUNDARY}--`;

  const response = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Google Drive upload failed: ${response.status} ${response.statusText} ${errorBody}`);
  }
}
