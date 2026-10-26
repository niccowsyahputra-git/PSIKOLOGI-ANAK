import { afterEach, describe, expect, it } from "vitest";
import {
  clientKeyFromRequest,
  consumeRateLimit,
  resetRateLimitsForTests,
} from "@/lib/rate-limit";

afterEach(() => {
  resetRateLimitsForTests();
});

describe("fixed-window rate limiter", () => {
  it("blocks the sixth attempt inside the window", () => {
    const results = Array.from({ length: 6 }, () =>
      consumeRateLimit("login:127.0.0.1", 5, 60_000),
    );

    expect(results.slice(0, 5).every((result) => result.allowed)).toBe(true);
    expect(results[4]?.remaining).toBe(0);
    expect(results[5]?.allowed).toBe(false);
    expect(results[5]?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps buckets independent per key", () => {
    consumeRateLimit("a", 1, 60_000);
    expect(consumeRateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(consumeRateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("allows traffic again after the window expires", async () => {
    expect(consumeRateLimit("window", 1, 20).allowed).toBe(true);
    expect(consumeRateLimit("window", 1, 20).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(consumeRateLimit("window", 1, 20).allowed).toBe(true);
  });

  it("derives a client key from the forwarded header with a loopback fallback", () => {
    const forwarded = new Request("http://127.0.0.1:3000", {
      headers: { "x-forwarded-for": "10.0.0.7, 10.0.0.8" },
    });
    expect(clientKeyFromRequest(forwarded)).toBe("10.0.0.7");
    expect(clientKeyFromRequest(new Request("http://127.0.0.1:3000"))).toBe(
      "loopback",
    );
  });
});
