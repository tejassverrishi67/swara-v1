/**
 * Device / session identity (Features.md F-05).
 *
 * The signature must be unforgeable without the secret, the cookie parser must
 * survive junk input, and two users must key to different Trust Ladder scopes.
 */

import { describe, expect, it } from "vitest";
import { parseCookies, scopeKey, signSessionId, verifySessionId } from "./identity.ts";

describe("session id signing", () => {
  const secret = "test-secret-abc";

  it("round-trips a signed id", () => {
    const token = signSessionId("device-1", secret);
    expect(verifySessionId(token, secret)).toBe("device-1");
  });

  it("rejects a tampered id", () => {
    const token = signSessionId("device-1", secret);
    const tampered = token.replace("device-1", "device-2");
    expect(verifySessionId(tampered, secret)).toBeUndefined();
  });

  it("rejects a token signed with a different secret", () => {
    const token = signSessionId("device-1", "other-secret");
    expect(verifySessionId(token, secret)).toBeUndefined();
  });

  it("rejects structurally invalid tokens", () => {
    expect(verifySessionId("", secret)).toBeUndefined();
    expect(verifySessionId("no-dot", secret)).toBeUndefined();
    expect(verifySessionId(".onlymac", secret)).toBeUndefined();
  });

  it("ids may contain dots — only the last segment is the mac", () => {
    const token = signSessionId("a.b.c", secret);
    expect(verifySessionId(token, secret)).toBe("a.b.c");
  });
});

describe("parseCookies", () => {
  it("parses a normal cookie header", () => {
    expect(parseCookies("a=1; b=two; swara_device=x.y")).toEqual({
      a: "1",
      b: "two",
      swara_device: "x.y",
    });
  });

  it("handles undefined / empty / malformed input", () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies("")).toEqual({});
    expect(parseCookies("garbage; =nokey; k=")).toEqual({ k: "" });
  });

  it("url-decodes values", () => {
    expect(parseCookies("k=a%20b%3Dc")).toEqual({ k: "a b=c" });
  });
});

describe("scopeKey", () => {
  it("namespaces by user and falls back to 'local'", () => {
    expect(scopeKey("u1", "leg+pain")).toBe("u1::leg+pain");
    expect(scopeKey(undefined, "leg+pain")).toBe("local::leg+pain");
  });

  it("two users cannot collide on the same concept combo", () => {
    expect(scopeKey("alice", "help+now")).not.toBe(scopeKey("bob", "help+now"));
  });
});
