import { describe, expect, it } from "vitest";
import { validatePasswordStrength } from "../../lib/password.js";

describe("validatePasswordStrength", () => {
  it("rejects a password shorter than 8 characters", () => {
    expect(validatePasswordStrength("short12")).toBe("password must be at least 8 characters");
  });

  it("accepts a password within the valid length range", () => {
    expect(validatePasswordStrength("a-valid-password")).toBeNull();
  });

  it("accepts a password exactly 72 bytes long", () => {
    expect(validatePasswordStrength("a".repeat(72))).toBeNull();
  });

  it("rejects a password longer than 72 bytes", () => {
    expect(validatePasswordStrength("a".repeat(73))).toBe("password must be at most 72 bytes");
  });

  it("rejects based on UTF-8 byte length, not character length", () => {
    // Each "é" is 2 bytes in UTF-8, so 40 of them is 80 bytes despite only
    // being 40 characters long.
    expect(validatePasswordStrength("é".repeat(40))).toBe("password must be at most 72 bytes");
  });
});
