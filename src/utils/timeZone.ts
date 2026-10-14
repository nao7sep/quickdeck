// The display zone setting (timestamp-conventions, Time zones): "system", which
// follows the computer's zone on every launch, or an IANA zone chosen from the
// platform's list.

export const SYSTEM_ZONE = "system";

// The computer's zone now, or UTC when the platform cannot say.
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// The platform's IANA zones; UTC alone where the platform cannot list them.
export function timeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return ["UTC"];
  }
}

// A saved value is "system" or a zone the platform knows.
export function isDisplayZone(value: unknown): value is string {
  return typeof value === "string" && (value === SYSTEM_ZONE || timeZones().includes(value));
}

// The zone times are shown in.
export function resolveTimeZone(setting: string): string {
  return setting === SYSTEM_ZONE ? systemTimeZone() : setting;
}
