export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function sanitizeFilename(name: string): string {
  return (
    name.replace(/[^a-zA-Z0-9._\- ]/g, "").trim().replace(/\s+/g, "_") ||
    "thumbnail"
  );
}

export function classes(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
