import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_COOKIE_MAX_AGE_MS,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_PATH,
  getAuthCookieOptions,
  readAuthCookie,
} from "../src/utils/auth-cookie.js";

test("auth cookie parsing matches the exact cookie name and decodes its value", () => {
  assert.equal(readAuthCookie(`other=ignored; ${AUTH_COOKIE_NAME}=a%2Eb.c`), "a.b.c");
  assert.equal(readAuthCookie(`not_${AUTH_COOKIE_NAME}=ignored`), undefined);
  assert.equal(readAuthCookie(`${AUTH_COOKIE_NAME}=`), undefined);
});

test("ambiguous or malformed auth cookies are rejected", () => {
  assert.equal(readAuthCookie(`${AUTH_COOKIE_NAME}=first; ${AUTH_COOKIE_NAME}=second`), undefined);
  assert.equal(readAuthCookie(`${AUTH_COOKIE_NAME}=%E0%A4%A`), undefined);
  assert.equal(readAuthCookie(undefined), undefined);
});

test("auth cookie issuance and clearing share secure host-only path settings", () => {
  const settings = { secure: true, sameSite: "none" as const };
  const issued = getAuthCookieOptions(settings);
  const cleared = getAuthCookieOptions(settings, true);

  assert.equal(issued.httpOnly, true);
  assert.equal(issued.secure, true);
  assert.equal(issued.sameSite, "none");
  assert.equal(issued.path, AUTH_COOKIE_PATH);
  assert.equal(issued.maxAge, AUTH_COOKIE_MAX_AGE_MS);
  assert.equal(issued.domain, undefined);
  assert.equal(cleared.httpOnly, issued.httpOnly);
  assert.equal(cleared.secure, issued.secure);
  assert.equal(cleared.sameSite, issued.sameSite);
  assert.equal(cleared.path, issued.path);
  assert.equal(cleared.maxAge, undefined);
  assert.equal(cleared.domain, undefined);
});
