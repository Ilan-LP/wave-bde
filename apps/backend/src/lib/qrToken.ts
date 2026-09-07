import { randomBytes } from "node:crypto";

export const QR_TOKEN_TTL_MS = 5 * 60 * 1000;

const QR_PAYLOAD_PREFIX = "wave:v1:";

/**
 * Opaque, unguessable buvette scan payload. Deliberately not the User/
 * PointsAccount id or email (both already appear elsewhere in the API/JWT),
 * so leaking those doesn't let anyone forge a QR code.
 */
export function generateQrPayload(): string {
  return `${QR_PAYLOAD_PREFIX}${randomBytes(32).toString("base64url")}`;
}
