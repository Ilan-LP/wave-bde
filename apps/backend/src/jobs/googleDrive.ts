import { google } from "googleapis";
import { env } from "../config/env.js";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function getServiceAccountCredentials(): { clientEmail: string; privateKey: string } {
  const { client_email: clientEmail, private_key: privateKey } = env.googleServiceAccount;
  if (typeof clientEmail !== "string" || typeof privateKey !== "string") {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing required fields client_email/private_key");
  }
  return { clientEmail, privateKey };
}

function getDriveClient() {
  const { clientEmail, privateKey } = getServiceAccountCredentials();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [DRIVE_SCOPE],
  });
  return google.drive({ version: "v3", auth });
}

/**
 * Uploads one JSON file to the Drive folder configured via
 * GOOGLE_DRIVE_FOLDER_ID. The folder must already be shared with the
 * service account's client_email (service accounts have no meaningful
 * personal Drive storage quota of their own).
 */
export async function uploadJsonExport(filename: string, data: unknown): Promise<void> {
  const drive = getDriveClient();
  await drive.files.create({
    requestBody: {
      name: filename,
      parents: [env.googleDriveFolderId],
    },
    media: {
      mimeType: "application/json",
      body: JSON.stringify(data),
    },
    fields: "id",
  });
}
