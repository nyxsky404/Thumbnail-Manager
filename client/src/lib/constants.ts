import type { CanvasPreset } from "../types";

export const PRESET_DIMENSIONS: Record<CanvasPreset, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 1080, height: 1920 },
};

export const FALLBACK_GOOGLE_FONTS = [
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Oswald",
  "Source Sans 3",
  "Raleway",
  "Poppins",
  "Inter",
  "Nunito",
  "Playfair Display",
  "Merriweather",
  "Bebas Neue",
  "Anton",
  "Bangers",
  "Pacifico",
  "Permanent Marker",
  "Lobster",
  "Noto Sans",
  "Noto Sans Devanagari",
];

export const STANDARD_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

export const MAX_TEXT_ELEMENTS = 20;
