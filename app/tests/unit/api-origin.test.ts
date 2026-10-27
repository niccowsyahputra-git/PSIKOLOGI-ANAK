import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { assertMutationOrigin } from "@/lib/api";
import { ForbiddenError } from "@/lib/errors";

const trusted = ["http://localhost:3000", "http://localhost:3000"];
const aliases = ["localhost", "127.0.0.1", "[::1]"];

function request(origin: string | null, site = "same-origin", url = "http://127.0.0.1:3000/api/children") {
  const headers = new Headers({ "sec-fetch-site": site });
  if (origin !== null) headers.set("origin", origin);
  return new NextRequest(url, { method: "POST", headers });
}

describe("mutation origin guard", () => {
  it("accepts the browser origin even when NextURL normalizes the loopback address", () => {
    const req = request("http://127.0.0.1:3000");
    expect(req.nextUrl.origin).toBe("http://localhost:3000");
    expect(() => assertMutationOrigin(req, trusted)).not.toThrow();
  });

  for (const configured of aliases) {
    for (const browser of aliases) {
      it(`accepts ${browser} with ${configured} configured at the same scheme and port`, () => {
        expect(() => assertMutationOrigin(request(`http://${browser}:3000`), [`http://${configured}:3000`])).not.toThrow();
      });
    }
  }

  it("retains the configured scheme and port when expanding aliases", () => {
    expect(() => assertMutationOrigin(request("https://127.0.0.1:3443"), ["https://localhost:3443"])).not.toThrow();
  });

  it("accepts the separately configured authentication origin", () => {
    expect(() => assertMutationOrigin(request("http://127.0.0.1:4000"), [...trusted, "http://localhost:4000"])).not.toThrow();
  });

  it.each([
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
    "https://localhost:3000",
    "https://127.0.0.1:3000",
    "http://localhost",
    "http://evil.test:3000",
    "http://localhost.evil.test:3000",
    "http://192.168.1.2:3000",
    "http://127.0.0.2:3000",
    "http://localhost:3000/path",
    "http://user@localhost:3000",
    "null",
    "not-a-url",
    "",
  ])("rejects an untrusted or malformed origin: %s", (origin) => {
    expect(() => assertMutationOrigin(request(origin), trusted)).toThrow(ForbiddenError);
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000", null])("rejects cross-site requests even with a trusted or absent origin: %s", (origin) => {
    expect(() => assertMutationOrigin(request(origin, "cross-site"), trusted)).toThrow(ForbiddenError);
  });

  it("does not trust a request URL, Host, or forwarded headers to extend the allowlist", () => {
    const req = request("http://evil.test:3000", "same-origin", "http://evil.test:3000/api/children");
    req.headers.set("host", "evil.test:3000");
    req.headers.set("x-forwarded-host", "evil.test:3000");
    req.headers.set("x-forwarded-proto", "http");
    expect(() => assertMutationOrigin(req, trusted)).toThrow(ForbiddenError);
  });

  it("does not expand loopback aliases from a configured nonloopback hostname", () => {
    expect(() => assertMutationOrigin(request("http://127.0.0.1:3000"), ["http://example.test:3000"])).toThrow(ForbiddenError);
  });

  it("retains support for nonbrowser clients without Origin or Fetch Metadata headers", () => {
    const req = new Request("http://localhost:3000/api/children", { method: "POST" });
    expect(() => assertMutationOrigin(req, trusted)).not.toThrow();
  });
});
