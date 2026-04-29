import { create } from "zustand";
import { api } from "../lib/api";
import type { CustomFont, Template, TextElement } from "../types";
import { uuid } from "../lib/utils";
import { MAX_TEXT_ELEMENTS } from "../lib/constants";

interface EditorState {
  template: Template | null;
  selectedId: string | null;
  dirty: boolean;
  saving: boolean;
  /** epoch ms of the most recent successful save; null if never saved. */
  lastSavedAt: number | null;
  error: string | null;

  load: (id: string) => Promise<void>;
  reset: () => void;

  setName: (name: string) => void;
  addText: () => void;
  updateElement: (id: string, patch: Partial<TextElement>) => void;
  removeElement: (id: string) => void;
  selectElement: (id: string | null) => void;
  bringElementToTop: (id: string) => void;

  addCustomFont: (font: CustomFont) => void;
  removeCustomFont: (id: string) => void;

  clearError: () => void;

  save: () => Promise<void>;
}

// How long a transient validation error (e.g. "max text elements reached")
// should sit on screen before auto-dismissing. Errors from network failures
// (load/save) are NOT auto-dismissed — the user needs to see those until they
// take action.
const TRANSIENT_ERROR_MS = 4000;
let transientErrorTimer: ReturnType<typeof setTimeout> | null = null;

function defaultElement(canvasWidth: number, canvasHeight: number): TextElement {
  return {
    id: uuid(),
    text: "Your Text",
    x: (canvasWidth - 400) / 2,
    y: (canvasHeight - 80) / 2,
    width: 400,
    height: 80,
    fontFamily: "Roboto",
    fontWeight: "400",
    fontSize: 48,
    lineHeight: 1.2,
    letterSpacing: 0,
    color: "#FFFFFF",
    align: "center",
    verticalAlign: "middle",
    shadow: { color: "#000000", x: 0, y: 2, blur: 4 },
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  template: null,
  selectedId: null,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  error: null,

  async load(id) {
    set({
      template: null,
      selectedId: null,
      dirty: false,
      lastSavedAt: null,
      error: null,
    });
    try {
      const t = await api.getTemplate(id);
      set({ template: t });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  reset() {
    set({
      template: null,
      selectedId: null,
      dirty: false,
      lastSavedAt: null,
      error: null,
    });
  },

  setName(name) {
    const t = get().template;
    if (!t) return;
    set({ template: { ...t, name }, dirty: true });
  },

  addText() {
    const t = get().template;
    if (!t) return;
    if (t.config_json.elements.length >= MAX_TEXT_ELEMENTS) {
      // Transient validation error: show it briefly then auto-clear so the
      // banner doesn't stick around after the user deletes an element.
      set({ error: `Max ${MAX_TEXT_ELEMENTS} text elements per template.` });
      if (transientErrorTimer) clearTimeout(transientErrorTimer);
      transientErrorTimer = setTimeout(() => {
        // Only clear if the error is still the same one we just set; a later
        // hard error (e.g. failed save) must not be wiped out by this timer.
        if (get().error?.startsWith("Max ")) set({ error: null });
        transientErrorTimer = null;
      }, TRANSIENT_ERROR_MS);
      return;
    }
    const el = defaultElement(t.canvas_width, t.canvas_height);
    set({
      template: {
        ...t,
        config_json: { elements: [...t.config_json.elements, el] },
      },
      selectedId: el.id,
      dirty: true,
    });
  },

  updateElement(id, patch) {
    const t = get().template;
    if (!t) return;
    set({
      template: {
        ...t,
        config_json: {
          elements: t.config_json.elements.map((e) =>
            e.id === id ? { ...e, ...patch } : e
          ),
        },
      },
      dirty: true,
    });
  },

  removeElement(id) {
    const t = get().template;
    if (!t) return;
    set({
      template: {
        ...t,
        config_json: {
          elements: t.config_json.elements.filter((e) => e.id !== id),
        },
      },
      selectedId: get().selectedId === id ? null : get().selectedId,
      dirty: true,
    });
  },

  selectElement(id) {
    set({ selectedId: id });
  },

  bringElementToTop(id) {
    const t = get().template;
    if (!t) return;
    const el = t.config_json.elements.find((e) => e.id === id);
    if (!el) return;
    const others = t.config_json.elements.filter((e) => e.id !== id);
    set({
      template: {
        ...t,
        config_json: { elements: [...others, el] },
      },
    });
  },

  addCustomFont(font) {
    const t = get().template;
    if (!t) return;
    set({
      template: { ...t, custom_fonts: [...t.custom_fonts, font] },
    });
  },

  removeCustomFont(id) {
    const t = get().template;
    if (!t) return;
    set({
      template: {
        ...t,
        custom_fonts: t.custom_fonts.filter((f) => f.id !== id),
      },
    });
  },

  clearError() {
    if (transientErrorTimer) {
      clearTimeout(transientErrorTimer);
      transientErrorTimer = null;
    }
    set({ error: null });
  },

  async save() {
    // Snapshot the template object at the moment we begin saving. We use
    // reference equality below to detect whether the user kept editing
    // while the request was in flight — if so, we must NOT overwrite their
    // newer local state with the server's echo of the older snapshot.
    const snapshot = get().template;
    if (!snapshot) return;
    if (get().saving) return; // single-flight; autosave loop will retry
    set({ saving: true, error: null });
    try {
      const updated = await api.updateTemplate(snapshot.id, {
        name: snapshot.name,
        config: snapshot.config_json,
      });
      const current = get().template;
      const now = Date.now();
      if (current === snapshot) {
        // No edits since save started — adopt the server's response in full.
        set({
          template: updated,
          dirty: false,
          saving: false,
          lastSavedAt: now,
        });
      } else {
        // User kept editing during the round-trip. Keep their local content,
        // sync only server-managed metadata (updated_at), and leave `dirty`
        // true so the autosave debounce schedules another flush.
        set({
          template: current
            ? { ...current, updated_at: updated.updated_at }
            : current,
          saving: false,
          lastSavedAt: now,
        });
      }
    } catch (e: any) {
      set({ error: e.message, saving: false });
    }
  },
}));
