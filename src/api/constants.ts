/**
 * Constants for NotebookLM internal API.
 *
 * Ported from jacob-bd/notebooklm-mcp-cli (MIT license).
 * These are reverse-engineered RPC IDs and enum codes used by
 * NotebookLM's batchexecute endpoint.
 */

// =========================================================================
// RPC IDs
// =========================================================================

export const RPC_IDS = {
  // Notebook operations
  LIST_NOTEBOOKS: "wXbhsf",
  GET_NOTEBOOK: "rLM1Ne",
  CREATE_NOTEBOOK: "CCqFvf",
  RENAME_NOTEBOOK: "s0tc2d",
  DELETE_NOTEBOOK: "WWINqb",

  // Source operations
  ADD_SOURCE: "izAoDd",
  GET_SOURCE: "hizoJc",
  DELETE_SOURCE: "tGMBJ",

  // Studio content RPCs
  CREATE_STUDIO: "R7cb6c",
  POLL_STUDIO: "gArtLc",
  DELETE_STUDIO: "V5N4be",
  RENAME_ARTIFACT: "rc3d8d",
  GET_INTERACTIVE_HTML: "v9rmvd",
  REVISE_SLIDE_DECK: "KmcKPe",

  // Mind map RPCs
  GENERATE_MIND_MAP: "yyryJe",
  SAVE_MIND_MAP: "CYK0Xb",
  LIST_MIND_MAPS: "cFji9",
  DELETE_MIND_MAP: "AH0mwd",

  // Misc
  GET_CONVERSATIONS: "hPTbtc",
  GET_SUMMARY: "VfAZjd",
  GET_SOURCE_GUIDE: "tr032e",
} as const;

// =========================================================================
// Studio Types
// =========================================================================

export const STUDIO_TYPE = {
  AUDIO: 1,
  REPORT: 2,
  VIDEO: 3,
  FLASHCARDS: 4, // Also Quiz (distinguished by inner format code)
  INFOGRAPHIC: 7,
  SLIDE_DECK: 8,
  DATA_TABLE: 9,
} as const;

// =========================================================================
// Audio
// =========================================================================

export const AUDIO_FORMAT = {
  DEEP_DIVE: 1,
  BRIEF: 2,
  CRITIQUE: 3,
  DEBATE: 4,
} as const;

export const AUDIO_LENGTH = {
  SHORT: 1,
  DEFAULT: 2,
  LONG: 3,
} as const;

// =========================================================================
// Video
// =========================================================================

export const VIDEO_FORMAT = {
  EXPLAINER: 1,
  BRIEF: 2,
  CINEMATIC: 3,
} as const;

export const VIDEO_STYLE = {
  AUTO_SELECT: 1,
  CUSTOM: 2,
  CLASSIC: 3,
  WHITEBOARD: 4,
  KAWAII: 5,
  ANIME: 6,
  WATERCOLOR: 7,
  RETRO_PRINT: 8,
  HERITAGE: 9,
  PAPER_CRAFT: 10,
} as const;

// =========================================================================
// Infographic
// =========================================================================

export const INFOGRAPHIC_ORIENTATION = {
  LANDSCAPE: 1,
  PORTRAIT: 2,
  SQUARE: 3,
} as const;

export const INFOGRAPHIC_DETAIL = {
  CONCISE: 1,
  STANDARD: 2,
  DETAILED: 3,
} as const;

export const INFOGRAPHIC_STYLE = {
  AUTO_SELECT: 1,
  SKETCH_NOTE: 2,
  PROFESSIONAL: 3,
  BENTO_GRID: 4,
  EDITORIAL: 5,
  INSTRUCTIONAL: 6,
  BRICKS: 7,
  CLAY: 8,
  ANIME: 9,
  KAWAII: 10,
  SCIENTIFIC: 11,
} as const;

// =========================================================================
// Slide Deck
// =========================================================================

export const SLIDE_DECK_FORMAT = {
  DETAILED: 1,
  PRESENTER: 2,
} as const;

export const SLIDE_DECK_LENGTH = {
  SHORT: 1,
  DEFAULT: 3,
} as const;

// =========================================================================
// Flashcards / Quiz
// =========================================================================

export const FLASHCARD_DIFFICULTY = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 3,
} as const;

export const FLASHCARD_COUNT_DEFAULT = 2;

// =========================================================================
// Report
// =========================================================================

export const REPORT_FORMAT = {
  BRIEFING_DOC: "Briefing Doc",
  STUDY_GUIDE: "Study Guide",
  BLOG_POST: "Blog Post",
  CUSTOM: "Create Your Own",
} as const;

// =========================================================================
// Human-readable name mappings (code -> name)
// =========================================================================

export function getAudioFormatName(code: number): string {
  const map: Record<number, string> = { 1: "deep_dive", 2: "brief", 3: "critique", 4: "debate" };
  return map[code] ?? "unknown";
}

export function getAudioLengthName(code: number): string {
  const map: Record<number, string> = { 1: "short", 2: "default", 3: "long" };
  return map[code] ?? "unknown";
}

export function getVideoFormatName(code: number): string {
  const map: Record<number, string> = { 1: "explainer", 2: "brief", 3: "cinematic" };
  return map[code] ?? "unknown";
}

export function getVideoStyleName(code: number | null | undefined): string {
  if (code == null) return "unknown";
  const map: Record<number, string> = {
    1: "auto_select", 2: "custom", 3: "classic", 4: "whiteboard",
    5: "kawaii", 6: "anime", 7: "watercolor", 8: "retro_print",
    9: "heritage", 10: "paper_craft",
  };
  return map[code] ?? "unknown";
}

export function getInfographicOrientationName(code: number): string {
  const map: Record<number, string> = { 1: "landscape", 2: "portrait", 3: "square" };
  return map[code] ?? "unknown";
}

export function getInfographicDetailName(code: number): string {
  const map: Record<number, string> = { 1: "concise", 2: "standard", 3: "detailed" };
  return map[code] ?? "unknown";
}

export function getInfographicStyleName(code: number): string {
  const map: Record<number, string> = {
    1: "auto_select", 2: "sketch_note", 3: "professional", 4: "bento_grid",
    5: "editorial", 6: "instructional", 7: "bricks", 8: "clay",
    9: "anime", 10: "kawaii", 11: "scientific",
  };
  return map[code] ?? "unknown";
}

export function getSlideDeckFormatName(code: number): string {
  const map: Record<number, string> = { 1: "detailed_deck", 2: "presenter_slides" };
  return map[code] ?? "unknown";
}

export function getSlideDeckLengthName(code: number): string {
  const map: Record<number, string> = { 1: "short", 3: "default" };
  return map[code] ?? "unknown";
}

export function getFlashcardDifficultyName(code: number): string {
  const map: Record<number, string> = { 1: "easy", 2: "medium", 3: "hard" };
  return map[code] ?? "unknown";
}

export function getStudioTypeName(code: number): string {
  const map: Record<number, string> = {
    1: "audio", 2: "report", 3: "video", 4: "flashcards",
    7: "infographic", 8: "slide_deck", 9: "data_table",
  };
  return map[code] ?? "unknown";
}
