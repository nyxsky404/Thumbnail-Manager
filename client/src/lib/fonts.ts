import type { CustomFont } from "../types";
import { FALLBACK_GOOGLE_FONTS, STANDARD_WEIGHTS } from "./constants";
import { slugify } from "./utils";

// Google Fonts — proxied through our backend so the browser never makes a
// cross-origin request to googleapis.com / gstatic.com. This avoids:
//   * ad-blockers / privacy extensions that often block fonts.googleapis.com
//   * corporate DNS blocks
//   * leaking the API key into the client bundle
// The endpoints are defined in server/app/api/google_fonts.py.
const _BASE = (import.meta as any).env.VITE_API_URL || "";
const LIST_URL = `${_BASE}/api/fonts/google/list`;
const CSS_URL = `${_BASE}/api/fonts/google/css`;

let cachedGoogleFontList: string[] | null = null;
let inflightFontList: Promise<string[]> | null = null;
const loadedGoogle = new Set<string>(); // "Family:weights"
const loadedCustom = new Set<string>(); // CustomFont id

// Signal Konva (and any other renderer that caches glyph metrics) that a new
// font face has just become available. We can't rely on `document.fonts`
// `loadingdone` because adding a *pre-loaded* `FontFace` (the path we use for
// custom fonts in `loadCustomFont`) does not transition the document's font
// loading state and therefore fires no event. Listeners bump their internal
// `fontVersion` on this event so cached text-metric calculations get
// invalidated and the canvas re-flows with the real glyph widths.
const FONT_LOADED_EVENT = "frammar:fontloaded";

function notifyFontLoaded() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(FONT_LOADED_EVENT));
  } catch {
    /* SSR / older browsers — no-op */
  }
}

export function onFontLoaded(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(FONT_LOADED_EVENT, handler);
  return () => window.removeEventListener(FONT_LOADED_EVENT, handler);
}

export async function fetchGoogleFontList(): Promise<string[]> {
  if (cachedGoogleFontList) return cachedGoogleFontList;
  // Coalesce concurrent callers so we only hit the API once.
  if (inflightFontList) return inflightFontList;
  inflightFontList = (async () => {
    try {
      const res = await fetch(LIST_URL);
      if (!res.ok) throw new Error(`Google Fonts list error ${res.status}`);
      const data = await res.json();
      const items = (data?.items || []) as Array<{ family: string }>;
      const families = items
        .map((i) => i?.family)
        .filter((f): f is string => typeof f === "string" && f.length > 0);
      // Only persist the cache when we actually got a real catalog; otherwise
      // a transient 503 (e.g. backend booting / API key not yet loaded) would
      // pin the fallback list for the entire page lifetime.
      if (families.length > 0) {
        cachedGoogleFontList = families;
        return cachedGoogleFontList;
      }
      console.warn("Google Fonts list was empty; using fallback (will retry next call)");
      return [...FALLBACK_GOOGLE_FONTS];
    } catch (e) {
      console.warn("Google Fonts list fetch failed; using fallback (will retry next call):", e);
      return [...FALLBACK_GOOGLE_FONTS];
    } finally {
      inflightFontList = null;
    }
  })();
  return inflightFontList;
}

// Hard timeout per font-load attempt. If the network is slow or the request
// is blocked we resolve anyway so the UI never hangs.
const FONT_LOAD_TIMEOUT_MS = 5000;

function googleCssHref(family: string, weights: number[]): string {
  // Google Fonts v2 CSS API uses `family=Family Name:wght@400;700`. We let
  // `encodeURIComponent` handle spaces (→ %20) and special chars, then our
  // backend forwards the decoded value to fonts.googleapis.com via httpx,
  // which re-encodes correctly. The proxy also rewrites all gstatic font-file
  // URLs in the response to /api/fonts/google/file?url=... so the browser
  // stays same-origin throughout.
  const sortedWeights = [...weights].sort((a, b) => a - b);
  const familyValue = `${family}:wght@${sortedWeights.join(";")}`;
  return `${CSS_URL}?family=${encodeURIComponent(familyValue)}`;
}

function loadGoogleFamilyWeights(family: string, weights: number[]): Promise<void> {
  const key = `${family}:${[...weights].sort().join(",")}`;
  if (loadedGoogle.has(key)) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      loadedGoogle.add(key); // mark attempted so we don't retry endlessly
      resolve();
    };
    const timer = window.setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn(`Font load timed out for "${family}" (${weights.join(",")})`);
      finish();
    }, FONT_LOAD_TIMEOUT_MS);

    const href = googleCssHref(family, weights);

    // Reuse a previously injected <link> with the same key (e.g. on remount).
    let link = document.querySelector<HTMLLinkElement>(
      `link[data-fontkey="${CSS.escape(key)}"]`
    );
    const alreadyInjected = !!link;

    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet";
      link.dataset.fontkey = key;
      link.href = href;
      document.head.appendChild(link);
    }

    const onStyleLoaded = async () => {
      // Stylesheet declarations are present; now wait for the actual font
      // faces to download so Konva (which renders to a 2D canvas) doesn't
      // paint with the fallback before the real font arrives.
      try {
        const fonts: any = (document as any).fonts;
        if (fonts?.load) {
          await Promise.all(
            weights.map((w) => fonts.load(`${w} 16px "${family}"`))
          );
        }
      } catch {
        /* swallow; we still resolve */
      }
      window.clearTimeout(timer);
      finish();
      // Wake up Konva (and any other glyph-metrics-cacher) now that the
      // real font is in document.fonts. document.fonts' own `loadingdone`
      // event also fires for Google fonts, but we double-tap here so the
      // signal is consistent across both Google and custom-font paths.
      notifyFontLoaded();
    };

    // If the link was already in the DOM (cache or earlier mount) and its
    // sheet is parsed, kick straight into the FontFace wait.
    if (alreadyInjected && (link as any).sheet) {
      onStyleLoaded();
      return;
    }

    link.addEventListener("load", onStyleLoaded, { once: true });
    link.addEventListener(
      "error",
      () => {
        window.clearTimeout(timer);
        // eslint-disable-next-line no-console
        console.warn(`Failed to load stylesheet for "${family}":`, href);
        finish();
      },
      { once: true }
    );
  });
}

export async function loadGoogleFont(
  family: string,
  weight: number = 400
): Promise<void> {
  // Always preload 400 + 700 on first selection; load specific weight if not already
  await loadGoogleFamilyWeights(family, [400, 700]);
  if (![400, 700].includes(weight)) {
    await loadGoogleFamilyWeights(family, [weight]);
  }
  // NOTE: intentionally do NOT `await document.fonts.ready` here. That promise
  // is shared across the document and re-arms whenever any new font enters
  // loading state, so awaiting it from many parallel callers can stall. The
  // per-face `document.fonts.load(...)` calls inside loadGoogleFamilyWeights
  // already signal completion for the families we care about.
}

export function customFontFamilyName(family: string): string {
  return `custom-${slugify(family)}`;
}

export async function loadCustomFont(font: CustomFont): Promise<void> {
  if (loadedCustom.has(font.id)) return;
  console.log("[loadCustomFont] id:", font.id, "url:", font.url);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((res) => window.setTimeout(res, attempt * 3000));
    }
    try {
      const ff = new FontFace(
        customFontFamilyName(font.family),
        `url(${font.url})`,
        { weight: String(font.weight), style: "normal" }
      );
      await ff.load();
      (document as any).fonts.add(ff);
      loadedCustom.add(font.id);
      notifyFontLoaded();
      return;
    } catch (e) {
      if (attempt === 2) {
        console.warn(`Failed to load custom font ${font.family} ${font.weight}:`, e);
      }
    }
  }
}

export async function loadAllCustomFonts(fonts: CustomFont[]): Promise<void> {
  await Promise.all(fonts.map(loadCustomFont));
  await (document as any).fonts?.ready;
}

export function availableWeightsForCustomFamily(
  family: string,
  customFonts: CustomFont[]
): number[] {
  return Array.from(
    new Set(
      customFonts
        .filter((f) => f.family === family)
        .map((f) => f.weight)
    )
  ).sort((a, b) => a - b);
}

export const STANDARD_FONT_WEIGHTS = STANDARD_WEIGHTS;
