import type { CustomFont, Template } from "../types";

// Empty BASE makes all requests relative ("/api/..."), which means same-origin
// in the browser. In dev, Vite's `server.proxy` (vite.config.ts) forwards
// `/api/*` to the FastAPI backend. In prod, the same path should be served by
// your reverse proxy. Override with VITE_API_URL only for unusual setups.
const BASE = (import.meta as any).env.VITE_API_URL || "";

async function http<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers:
      options.body instanceof FormData
        ? options.headers
        : { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* noop */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listTemplates: () => http<Template[]>("/api/templates"),
  getTemplate: (id: string) => http<Template>(`/api/templates/${id}`),
  createTemplate: (data: { name: string; preset: string; file: File }) => {
    const fd = new FormData();
    fd.append("name", data.name);
    fd.append("preset", data.preset);
    fd.append("file", data.file);
    return http<Template>("/api/templates", { method: "POST", body: fd });
  },
  updateTemplate: (
    id: string,
    body: { name?: string; config?: { elements: any[] } }
  ) =>
    http<Template>(`/api/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteTemplate: (id: string) =>
    http<void>(`/api/templates/${id}`, { method: "DELETE" }),
  setDefault: (id: string) =>
    http<Template>(`/api/templates/${id}/default`, { method: "POST" }),
  uploadFont: (
    templateId: string,
    data: { family: string; weight: number; file: File }
  ) => {
    const fd = new FormData();
    fd.append("family", data.family);
    fd.append("weight", String(data.weight));
    fd.append("file", data.file);
    return http<CustomFont>(`/api/templates/${templateId}/fonts`, {
      method: "POST",
      body: fd,
    });
  },
  deleteFont: (templateId: string, fontId: string) =>
    http<void>(`/api/templates/${templateId}/fonts/${fontId}`, {
      method: "DELETE",
    }),
};
