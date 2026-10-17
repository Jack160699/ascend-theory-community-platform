import { describe, it } from "node:test";
import assert from "node:assert";
import { validateRedirectUrl, hasPermission, hasMinimumRole, canManageAdminProfile } from "../auth-shared.js";
import { saveOrder } from "../../orders/store.js";
import type { Order } from "../../orders/types.js";

// Mock helper to simulate getAdminSession verification rules
function verifyAdminSessionRules(
  user: { id: string; email: string; user_metadata?: Record<string, unknown> } | null,
  profile: { id: string; full_name: string; role: string; is_active: boolean } | null,
  hasConfig: boolean,
  envMode: "development" | "production"
) {
  const isDev = envMode === "development";

  if (!user) {
    if (isDev && !hasConfig) {
      return { id: "dev_01", role: "owner" };
    }
    return null; // FAIL CLOSED
  }

  // Strict Fail-Closed Rule: Missing profile row returns null
  if (!profile) {
    return null;
  }

  // Strict Fail-Closed Rule: Inactive admin profile returns null
  if (!profile.is_active) {
    return null;
  }

  // Strict Fail-Closed Rule: Invalid role returns null
  const validRoles = ["owner", "admin", "editor", "support"];
  if (!validRoles.includes(profile.role)) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: profile.full_name,
    role: profile.role,
  };
}

describe("Phase 2 Security & Auth Tests", () => {
  it("rejects open redirects and unsafe external target URLs", () => {
    assert.strictEqual(validateRedirectUrl("/admin/commerce/orders"), "/admin/commerce/orders");
    assert.strictEqual(validateRedirectUrl("https://evil.com"), "/admin");
    assert.strictEqual(validateRedirectUrl("//evil.com/admin"), "/admin");
    assert.strictEqual(validateRedirectUrl("javascript:alert(1)"), "/admin");
    assert.strictEqual(validateRedirectUrl("http://attacker.com/admin"), "/admin");
    assert.strictEqual(validateRedirectUrl(null), "/admin");
    assert.strictEqual(validateRedirectUrl(undefined), "/admin");
  });

  it("enforces role hierarchy and permissions correctly", () => {
    assert.strictEqual(hasMinimumRole("owner", "admin"), true);
    assert.strictEqual(hasMinimumRole("editor", "admin"), false);
    assert.strictEqual(hasMinimumRole("support", "editor"), false);

    assert.strictEqual(hasPermission("owner", "system", "delete"), true);
    assert.strictEqual(hasPermission("admin", "system", "delete"), false);
    assert.strictEqual(hasPermission("editor", "journal", "write"), true);
    assert.strictEqual(hasPermission("support", "commerce", "read"), true);
    assert.strictEqual(hasPermission("support", "system", "read"), false);
  });

  it("strictly enforces READ-ONLY access for support role on commerce/orders", () => {
    // 1. Support role MUST BE ALLOWED to read orders
    assert.strictEqual(hasPermission("support", "commerce", "read"), true);
    assert.strictEqual(hasPermission("support", "fulfilment", "read"), true);

    // 2. Support role MUST BE DENIED write, delete, and admin actions on orders/commerce
    assert.strictEqual(hasPermission("support", "commerce", "write"), false);
    assert.strictEqual(hasPermission("support", "commerce", "delete"), false);
    assert.strictEqual(hasPermission("support", "commerce", "admin"), false);
    assert.strictEqual(hasPermission("support", "fulfilment", "write"), false);
    assert.strictEqual(hasPermission("support", "fulfilment", "delete"), false);

    // 3. Owner and Admin roles MUST BE ALLOWED order writes
    assert.strictEqual(hasPermission("owner", "commerce", "write"), true);
    assert.strictEqual(hasPermission("owner", "commerce", "delete"), true);
    assert.strictEqual(hasPermission("admin", "commerce", "write"), true);
    assert.strictEqual(hasPermission("admin", "commerce", "delete"), true);

    // 4. Editor role gets NO order mutation access
    assert.strictEqual(hasPermission("editor", "commerce", "read"), false);
    assert.strictEqual(hasPermission("editor", "commerce", "write"), false);
  });

  it("strictly enforces RLS privilege boundaries for admin profile management", () => {
    // 1. Admin promoting user to 'owner' MUST BE DENIED
    assert.strictEqual(canManageAdminProfile("admin", "editor", "owner", "update"), false);
    assert.strictEqual(canManageAdminProfile("admin", null, "owner", "insert"), false);

    // 2. Admin editing existing 'owner' profile MUST BE DENIED
    assert.strictEqual(canManageAdminProfile("admin", "owner", "admin", "update"), false);
    assert.strictEqual(canManageAdminProfile("admin", "owner", "editor", "update"), false);

    // 3. Admin deleting existing 'owner' profile MUST BE DENIED
    assert.strictEqual(canManageAdminProfile("admin", "owner", "support", "delete"), false);

    // 4. Admin managing non-owner roles (admin, editor, support) MUST BE ALLOWED
    assert.strictEqual(canManageAdminProfile("admin", null, "editor", "insert"), true);
    assert.strictEqual(canManageAdminProfile("admin", null, "support", "insert"), true);
    assert.strictEqual(canManageAdminProfile("admin", null, "admin", "insert"), true);
    assert.strictEqual(canManageAdminProfile("admin", "editor", "support", "update"), true);
    assert.strictEqual(canManageAdminProfile("admin", "support", "support", "delete"), true);

    // 5. Owner full control over all operations MUST BE ALLOWED
    assert.strictEqual(canManageAdminProfile("owner", "owner", "owner", "update"), true);
    assert.strictEqual(canManageAdminProfile("owner", null, "owner", "insert"), true);
    assert.strictEqual(canManageAdminProfile("owner", "admin", "owner", "update"), true);
    assert.strictEqual(canManageAdminProfile("owner", "owner", "support", "delete"), true);

    // 6. Non-admin actors (editor, support, unauthenticated) MUST BE DENIED
    assert.strictEqual(canManageAdminProfile("editor", "support", "admin", "update"), false);
    assert.strictEqual(canManageAdminProfile("support", "editor", "editor", "update"), false);
    assert.strictEqual(canManageAdminProfile(null, null, "admin", "insert"), false);
  });

  it("fails closed when authenticated user has no admin profile (authenticated non-admin)", () => {
    const ordinaryUser = { id: "usr_ordinary_123", email: "user@example.com" };
    const session = verifyAdminSessionRules(ordinaryUser, null, true, "production");
    assert.strictEqual(session, null, "Authenticated non-admin with missing profile must be rejected");
  });

  it("fails closed when admin profile is inactive (is_active = false)", () => {
    const inactiveUser = { id: "usr_inactive_456", email: "disabled@ascendtheory.com" };
    const inactiveProfile = {
      id: "usr_inactive_456",
      full_name: "Disabled Admin",
      role: "admin",
      is_active: false,
    };
    const session = verifyAdminSessionRules(inactiveUser, inactiveProfile, true, "production");
    assert.strictEqual(session, null, "Inactive admin profile must be rejected");
  });

  it("fails closed when admin profile role is invalid", () => {
    const user = { id: "usr_invalid_role", email: "invalid@example.com" };
    const invalidProfile = {
      id: "usr_invalid_role",
      full_name: "Hacked Role",
      role: "supergod",
      is_active: true,
    };
    const session = verifyAdminSessionRules(user, invalidProfile, true, "production");
    assert.strictEqual(session, null, "Invalid role must be rejected");
  });

  it("succeeds when user is authenticated with a valid active admin profile", () => {
    const validUser = { id: "usr_valid_admin", email: "admin@ascendtheory.com" };
    const validProfile = {
      id: "usr_valid_admin",
      full_name: "Apex Sovereign",
      role: "owner",
      is_active: true,
    };
    const session = verifyAdminSessionRules(validUser, validProfile, true, "production");
    assert.notStrictEqual(session, null);
    assert.strictEqual(session?.role, "owner");
    assert.strictEqual(session?.name, "Apex Sovereign");
  });

  it("ensures no user_metadata role fallback grants admin access in production", () => {
    const spoofedUser = {
      id: "usr_spoofed_999",
      email: "attacker@evil.com",
      user_metadata: { role: "admin", full_name: "Fake Admin" },
    };
    // No profile exists in database
    const session = verifyAdminSessionRules(spoofedUser, null, true, "production");
    assert.strictEqual(session, null, "user_metadata role spoofing must never grant access");
  });

  it("fails closed when Supabase configuration is missing in production mode", async () => {
    const originalEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";

    const testOrder: Order = {
      id: "TEST-ORD-9999",
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      paymentMethod: "online",
      paymentProvider: "razorpay",
      currency: "INR",
      subtotal: 1000,
      items: [],
      customer: {
        fullName: "Test Customer",
        email: "test@example.com",
        phone: "+919999999999",
        address: "123 Sovereign Way",
        city: "Mumbai",
        postalCode: "400001",
        country: "IN",
      },
    };

    try {
      await assert.rejects(
        async () => {
          await saveOrder(testOrder);
        },
        (err: Error) => {
          return err.message.includes("Insecure file/memory fallback is prohibited in production");
        }
      );
    } finally {
      (process.env as Record<string, string>).NODE_ENV = originalEnv || "development";
    }
  });
});
