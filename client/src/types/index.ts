export type CanvasPreset = "16:9" | "9:16";

export interface Shadow {
  color: string;
  x: number;
  y: number;
  blur: number;
}

export interface TextElement {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  italic?: boolean;
  underline?: boolean;
  lineThrough?: boolean;
  shadow?: Shadow;
  textSizing?: "auto" | "fixed";
}

export interface CustomFont {
  id: string;
  family: string;
  weight: number;
  url: string;
  format: "ttf" | "otf";
  created_at: string;
}

export interface MissingFont {
  family: string;
  weight: string;
  used_in_element_ids: string[];
}

export interface Template {
  id: string;
  name: string;
  thumbnail_url: string;
  preset: CanvasPreset;
  canvas_width: number;
  canvas_height: number;
  is_default: boolean;
  config_json: {
    elements: TextElement[];
    /**
     * Populated by PSD import; empty for PNG-uploaded templates and once the
     * user has resolved (uploaded fonts for) or dismissed all entries.
     */
    missing_fonts?: MissingFont[];
  };
  custom_fonts: CustomFont[];
  created_at: string;
  updated_at: string;
}
