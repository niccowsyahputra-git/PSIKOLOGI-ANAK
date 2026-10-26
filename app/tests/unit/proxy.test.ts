import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const request = (path: string, cookie: string) => new NextRequest(`http://127.0.0.1:3000${path}`, { headers: { cookie } });

describe("staff/participant routing", () => {
  it("ignores an empty intake cookie after a staff login", () => {
    const result = proxy(request("/dashboard", "better-auth.session_token=staff; panti.intake="));
    expect(result.headers.get("location")).toBeNull();
    expect(proxy(request("/login", "better-auth.session_token=staff; panti.intake=")).headers.get("location")).toBe("http://127.0.0.1:3000/dashboard");
  });
  it("keeps a participant out of all staff routes even if a staff cookie remains", () => {
    for (const path of ["/dashboard", "/children", "/guardians", "/cycles/123", "/assessments", "/admin/users", "/instruments"]) {
      expect(proxy(request(path, "better-auth.session_token=staff; panti.intake=participant")).headers.get("location")).toBe("http://127.0.0.1:3000/intake");
    }
  });
  it("redirects anonymous users to staff login", () => {
    expect(proxy(request("/children", "panti.intake=")).headers.get("location")).toBe("http://127.0.0.1:3000/login");
  });
});
