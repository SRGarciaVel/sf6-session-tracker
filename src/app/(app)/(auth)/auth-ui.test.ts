import { describe, expect, it } from "vitest";
import { authErrorKey, maskEmail } from "./auth-ui";

describe("auth UI helpers", () => {
  it("masks addresses (≤ 2 visible characters)", () => {
    expect(maskEmail("streamer@example.com")).toBe("st***@example.com");
    expect(maskEmail("ab@x.dev")).toBe("a***@x.dev");
    expect(maskEmail("a@x.dev")).toBe("a***@x.dev");
    expect(maskEmail("nonsense")).toBe("***");
  });

  it("maps Better Auth codes to our copy; unknown → generic (raw messages never shown)", () => {
    expect(authErrorKey({ code: "EMAIL_NOT_VERIFIED", status: 403 })).toBe("emailNotVerified");
    expect(authErrorKey({ status: 429 })).toBe("tooManyRequests");
    expect(authErrorKey({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe("invalidCredentials");
    expect(authErrorKey({ code: "PASSWORD_TOO_LONG" })).toBe("passwordTooLong");
    expect(authErrorKey({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe("generic");
    expect(authErrorKey({ code: "INVALID_CALLBACK" })).toBe("generic");
  });
});
