import { create } from "zustand";
import { api } from "../lib/api";
import type { Template } from "../types";

interface TemplatesState {
  templates: Template[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (data: { name: string; preset: string; file: File }) => Promise<Template>;
  remove: (id: string) => Promise<void>;
  setDefault: (id: string) => Promise<void>;
}

export const useTemplatesStore = create<TemplatesState>((set, get) => ({
  templates: [],
  loading: false,
  error: null,
  async load() {
    set({ loading: true, error: null });
    try {
      const templates = await api.listTemplates();
      set({ templates, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },
  async create(data) {
    const t = await api.createTemplate(data);
    set({ templates: [t, ...get().templates] });
    return t;
  },
  async remove(id) {
    await api.deleteTemplate(id);
    await get().load();
  },
  async setDefault(id) {
    await api.setDefault(id);
    set({
      templates: get().templates.map((t) => ({ ...t, is_default: t.id === id })),
    });
  },
}));
