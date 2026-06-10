import { describe, expect, it } from "vitest";
import { buildConsoleObject, buildLogEvent, serializeError } from "../../src/services/logger";

const ISO_MS_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("buildLogEvent", () => {
  it("assembles the envelope with a canonical UTC ISO-8601-ms-Z time", () => {
    const event = buildLogEvent("info", "hello", { op: "load" });
    expect(event.level).toBe("info");
    expect(event.message).toBe("hello");
    expect(event.fields).toEqual({ op: "load" });
    expect(event.time).toMatch(ISO_MS_Z);
  });

  it("defaults fields to an empty object when omitted", () => {
    const event = buildLogEvent("warn", "no fields");
    expect(event.fields).toEqual({});
  });
});

describe("serializeError", () => {
  it("captures name, message, and stack from an Error", () => {
    const error = new Error("boom");
    const result = serializeError(error);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("boom");
    expect(typeof result.stack).toBe("string");
  });

  it("walks the full cause chain rather than only the top message", () => {
    const root = new Error("root cause");
    const wrapped = new Error("wrapper", { cause: root });
    const result = serializeError(wrapped);
    expect(result.message).toBe("wrapper");
    const cause = result.cause as Record<string, unknown>;
    expect(cause.message).toBe("root cause");
    expect(cause.name).toBe("Error");
  });

  it("preserves a custom error subtype's name", () => {
    class TimeoutError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "TimeoutError";
      }
    }
    const result = serializeError(new TimeoutError("too slow"));
    expect(result.name).toBe("TimeoutError");
    expect(result.message).toBe("too slow");
  });

  it("records non-Error throwables as a stringified value", () => {
    expect(serializeError("plain string")).toEqual({ value: "plain string" });
    expect(serializeError(42)).toEqual({ value: "42" });
  });

  it("does not overflow on a self-referential cause cycle", () => {
    const err = new Error("loops to itself");
    (err as { cause?: unknown }).cause = err;
    // Must return (not throw RangeError) — logging may never crash the app.
    const result = serializeError(err);
    expect(result.message).toBe("loops to itself");
    const cause = result.cause as Record<string, unknown>;
    expect(cause.truncated).toBe(true);
  });

  it("does not overflow on a mutually-referential cause cycle", () => {
    const a = new Error("a");
    const b = new Error("b");
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;
    expect(() => serializeError(a)).not.toThrow();
  });

  it("truncates a pathologically deep cause chain", () => {
    let err = new Error("leaf");
    for (let i = 0; i < 50; i += 1) {
      err = new Error(`wrap ${i}`, { cause: err });
    }
    // Walk down the serialized chain; it must terminate in a `truncated` marker
    // rather than recursing 50 deep.
    let node = serializeError(err);
    let sawTruncated = false;
    for (let i = 0; i < 100 && node; i += 1) {
      if (node.truncated === true) {
        sawTruncated = true;
        break;
      }
      node = node.cause as Record<string, unknown>;
    }
    expect(sawTruncated).toBe(true);
  });
});

describe("buildConsoleObject", () => {
  it("redacts denied field names, including nested ones, before output", () => {
    const out = buildConsoleObject(
      buildLogEvent("error", "save failed", {
        password: "hunter2",
        context: { token: "sk-1", retries: 2 },
      }),
    );
    expect(out.password).toBe("[redacted]");
    expect((out.context as Record<string, unknown>).token).toBe("[redacted]");
    // Non-denied siblings are preserved.
    expect((out.context as Record<string, unknown>).retries).toBe(2);
  });

  it("keeps the envelope authoritative and preserves colliding fields (suffixed)", () => {
    const out = buildConsoleObject(
      buildLogEvent("warn", "real message", { message: "spoofed", ok: true }),
    );
    expect(out.message).toBe("real message");
    expect(out.level).toBe("warn");
    // The colliding free field is preserved under a suffixed key, not dropped or
    // allowed to overwrite the envelope — matching the Rust file path.
    expect(out.message_).toBe("spoofed");
    expect(out.ok).toBe(true);
  });
});
