import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGeminiKey, getGeminiKey, isPlausibleGeminiKey, readGeminiKey, setGeminiKey } from "./gemini-key";

const KEY = "AIzaSyOwnKeyForTesting_1234567890abcd";
const fakeStorage = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), size: () => m.size };
};
let local: ReturnType<typeof fakeStorage>;
let session: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  local = fakeStorage();
  session = fakeStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
});
afterEach(() => vi.unstubAllGlobals());

describe("remembering the key", () => {
  it("'device' keeps it in LocalStorage only", () => {
    expect(setGeminiKey(KEY, "device")).toBe(true);
    expect(local.size()).toBe(1);
    expect(session.size()).toBe(0);
    expect(readGeminiKey()).toEqual({ key: KEY, mode: "device" });
  });

  it("'session' keeps it in sessionStorage only, so closing the browser forgets it", () => {
    setGeminiKey(KEY, "session");
    expect(session.size()).toBe(1);
    expect(local.size()).toBe(0);
    expect(readGeminiKey()).toEqual({ key: KEY, mode: "session" });
    session.removeItem("gold-assistant:gemini-key"); // what a browser restart does
    expect(getGeminiKey()).toBeNull();
  });

  it("switching the choice moves the key and never leaves a copy behind", () => {
    setGeminiKey(KEY, "device");
    setGeminiKey(KEY, "session");
    expect(local.size()).toBe(0);
    expect(session.size()).toBe(1);
    setGeminiKey(KEY, "device");
    expect(session.size()).toBe(0);
    expect(local.size()).toBe(1);
  });

  it("an empty key clears it (that is how 'remove my key' works)", () => {
    setGeminiKey(KEY, "device");
    expect(setGeminiKey("   ", "device")).toBe(true);
    expect(getGeminiKey()).toBeNull();
  });

  it("trims whitespace around a pasted key", () => {
    setGeminiKey(`  ${KEY}\n`, "device");
    expect(getGeminiKey()).toBe(KEY);
  });

  it("clearGeminiKey removes it from both places", () => {
    local.setItem("gold-assistant:gemini-key", KEY);
    session.setItem("gold-assistant:gemini-key", KEY);
    clearGeminiKey();
    expect(getGeminiKey()).toBeNull();
  });

  it("is never written under the Settings key, so it cannot leak into a settings export", () => {
    setGeminiKey(KEY, "device");
    expect(local.getItem("gold-assistant:settings")).toBeNull();
    expect(local.getItem("gold-assistant:gemini-key")).toBe(KEY); // only under its own name
  });
});

describe("when the browser blocks storage", () => {
  it("reports that it could not remember, and reading never throws", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    vi.stubGlobal("localStorage", blocked);
    vi.stubGlobal("sessionStorage", blocked);
    expect(setGeminiKey(KEY, "device")).toBe(false);
    expect(getGeminiKey()).toBeNull();
    expect(() => clearGeminiKey()).not.toThrow();
  });

  it("reports false when the storage object itself is missing or throws on access", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(setGeminiKey(KEY, "device")).toBe(false);
    expect(getGeminiKey()).toBeNull();
  });
});

describe("isPlausibleGeminiKey", () => {
  it.each([[KEY, true], ["short", false], ["has spaces in it which makes it not a key", false], ["", false], ["x".repeat(300), false]])("%s -> %s", (k, ok) =>
    expect(isPlausibleGeminiKey(k)).toBe(ok));
});
