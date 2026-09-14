import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// No corresponding real password exists for this hash. Compare against it
// whenever a login fails before a real hash is available (unknown email, no
// Member, inactive account) so that path costs the same bcrypt work as a
// real wrong-password attempt — otherwise the early return is a timing
// side-channel that lets an attacker enumerate registered emails.
const DUMMY_HASH = bcrypt.hashSync("wave-bde-timing-normalization", SALT_ROUNDS);

export async function verifyDummyPassword(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}

const MIN_PASSWORD_LENGTH = 8;

// bcrypt silently truncates its input at 72 bytes — anything beyond that
// is ignored, so two different passwords sharing the same first 72 bytes
// would hash identically. Reject upfront instead of accepting a password
// whose extra bytes are never actually checked. This is a byte count, not
// a character count, since bcrypt operates on the UTF-8 encoding.
const MAX_PASSWORD_LENGTH_BYTES = 72;

// Returns an error message if the password is too weak, or null if it's
// acceptable. Deliberately just a length floor/ceiling, no composition
// rules (uppercase/digit/symbol) — see CLAUDE.md "Authentication" for why.
export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(plain, "utf8") > MAX_PASSWORD_LENGTH_BYTES) {
    return `password must be at most ${MAX_PASSWORD_LENGTH_BYTES} bytes`;
  }
  return null;
}
