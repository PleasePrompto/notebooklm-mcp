/**
 * Studio Client for NotebookLM artifact generation.
 *
 * Ported from jacob-bd/notebooklm-mcp-cli studio.py (MIT license).
 * Creates studio artifacts (audio, video, reports, quizzes, flashcards,
 * infographics, slide decks, data tables, mind maps) via direct RPC calls.
 */

import type { Page, BrowserContext } from "patchright";
import { RPCClient } from "./rpc-client.js";
import {
  RPC_IDS,
  STUDIO_TYPE,
  AUDIO_FORMAT,
  AUDIO_LENGTH,
  VIDEO_FORMAT,
  VIDEO_STYLE,
  INFOGRAPHIC_ORIENTATION,
  INFOGRAPHIC_DETAIL,
  INFOGRAPHIC_STYLE,
  SLIDE_DECK_FORMAT,
  SLIDE_DECK_LENGTH,
  FLASHCARD_DIFFICULTY,
  FLASHCARD_COUNT_DEFAULT,
  getAudioFormatName,
  getAudioLengthName,
  getVideoFormatName,
  getVideoStyleName,
  getInfographicOrientationName,
  getInfographicDetailName,
  getInfographicStyleName,
  getSlideDeckFormatName,
  getSlideDeckLengthName,
  getFlashcardDifficultyName,
  getStudioTypeName,
} from "./constants.js";
import { log } from "../utils/logger.js";

export interface StudioArtifact {
  artifact_id: string | null;
  notebook_id: string;
  type: string;
  status: string;
  [key: string]: unknown;
}

export interface StudioStatusArtifact {
  artifact_id: string;
  title: string;
  type: string;
  status: string;
  audio_url?: string | null;
  video_url?: string | null;
  infographic_url?: string | null;
  slide_deck_url?: string | null;
  report_content?: string | null;
  flashcard_count?: number | null;
  duration_seconds?: number | null;
  custom_instructions?: string | null;
  created_at?: string | null;
}

/**
 * Extract notebook ID from a NotebookLM URL.
 * URL format: https://notebooklm.google.com/notebook/<id>
 */
export function extractNotebookId(url: string): string {
  const match = url.match(/notebook\/([a-f0-9-]+)/i);
  if (!match) {
    throw new Error(`Could not extract notebook ID from URL: ${url}`);
  }
  return match[1];
}

/**
 * Normalize raw artifact status code to a stable label.
 */
function normalizeStudioStatus(artifactData: unknown[]): string {
  if (!Array.isArray(artifactData) || artifactData.length <= 4) return "unknown";

  const statusCode = artifactData[4];
  if (statusCode === 1) return "in_progress";
  if (statusCode === 3) return "completed";
  if (statusCode === 4) return "failed";

  // Audio status=2 with media URLs means completed
  const typeCode = artifactData[2];
  if (statusCode === 2 && typeCode === STUDIO_TYPE.AUDIO) {
    if (audioHasMediaUrls(artifactData)) return "completed";
  }

  return "unknown";
}

function audioHasMediaUrls(artifactData: unknown[]): boolean {
  if (artifactData.length <= 6) return false;
  const audioOptions = artifactData[6];
  if (!Array.isArray(audioOptions) || audioOptions.length <= 5) return false;
  const mediaList = audioOptions[5];
  if (!Array.isArray(mediaList)) return false;

  return mediaList.some(
    (item: unknown) =>
      Array.isArray(item) &&
      item.length > 0 &&
      typeof item[0] === "string" &&
      item[0].startsWith("http")
  );
}

function extractAudioMediaUrl(artifactData: unknown[]): string | null {
  if (artifactData.length <= 6) return null;
  const audioOptions = artifactData[6];
  if (!Array.isArray(audioOptions)) return null;

  if (audioOptions.length > 5 && Array.isArray(audioOptions[5])) {
    const mediaList = audioOptions[5];

    // Prefer -dv download variant
    for (const item of mediaList) {
      if (
        Array.isArray(item) &&
        item.length > 2 &&
        typeof item[0] === "string" &&
        item[0].startsWith("http") &&
        item[2] === "audio/mp4" &&
        item[0].endsWith("-dv")
      ) {
        return item[0];
      }
    }

    // Any audio/mp4 URL
    for (const item of mediaList) {
      if (
        Array.isArray(item) &&
        item.length > 2 &&
        typeof item[0] === "string" &&
        item[0].startsWith("http") &&
        item[2] === "audio/mp4"
      ) {
        return item[0];
      }
    }

    // First valid URL
    for (const item of mediaList) {
      if (
        Array.isArray(item) &&
        item.length > 0 &&
        typeof item[0] === "string" &&
        item[0].startsWith("http")
      ) {
        return item[0];
      }
    }
  }

  // Older payloads: direct URL at position 3
  if (audioOptions.length > 3 && typeof audioOptions[3] === "string") {
    return audioOptions[3];
  }

  return null;
}

/**
 * Studio client that uses direct RPC calls to create NotebookLM artifacts.
 */
export class StudioClient {
  private rpcClient: RPCClient;

  constructor() {
    this.rpcClient = new RPCClient();
  }

  /**
   * Set the browser page for making authenticated API calls.
   */
  setPage(page: Page): void {
    this.rpcClient.setPage(page);
  }

  /**
   * Set the browser context (creates a page internally if needed).
   */
  setContext(context: BrowserContext): void {
    this.rpcClient.setContext(context);
  }

  /**
   * Get all source IDs from a notebook.
   * Uses the GET_NOTEBOOK RPC with the correct parameter format.
   */
  async getSourceIds(notebookId: string): Promise<string[]> {
    try {
      // Correct params per Python reference: [notebook_id, None, [2], None, 0]
      const result = await this.rpcClient.callRpc(
        RPC_IDS.GET_NOTEBOOK,
        [notebookId, null, [2], null, 0],
        `/notebook/${notebookId}`
      );

      if (!result || !Array.isArray(result)) return [];

      const sourceIds: string[] = [];

      // Per Python reference: notebook_data[0][1] contains sources array
      // Each source: [[id], title, metadata, ...]
      const notebookData = Array.isArray(result[0]) ? result[0] : result;
      const sourcesData = notebookData.length > 1 ? notebookData[1] : [];

      if (Array.isArray(sourcesData)) {
        for (const src of sourcesData) {
          if (Array.isArray(src) && src.length >= 1) {
            // Source ID is at src[0][0] (nested in array)
            const idContainer = src[0];
            if (Array.isArray(idContainer) && idContainer.length > 0 && typeof idContainer[0] === "string") {
              sourceIds.push(idContainer[0]);
            }
          }
        }
      }

      return sourceIds;
    } catch (error) {
      log.warning(`  [Studio] Could not get source IDs: ${error}`);
      return [];
    }
  }

  // =========================================================================
  // Audio Overview
  // =========================================================================

  async createAudioOverview(
    notebookId: string,
    options: {
      sourceIds?: string[];
      format?: number;
      length?: number;
      language?: string;
      focusPrompt?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      format = AUDIO_FORMAT.DEEP_DIVE,
      length = AUDIO_LENGTH.DEFAULT,
      language = "en",
      focusPrompt = "",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);
    const sourcesSimple = sourceIds.map((sid) => [sid]);

    const audioOptions = [
      null,
      [focusPrompt, length, null, sourcesSimple, language, null, format],
    ];

    const params = [
      [2],
      notebookId,
      [null, null, STUDIO_TYPE.AUDIO, sourcesNested, null, null, audioOptions],
    ];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "audio",
        status: normalizeStudioStatus(artifactData as unknown[]),
        format: getAudioFormatName(format),
        length: getAudioLengthName(length),
        language,
      };
    }

    return null;
  }

  // =========================================================================
  // Video Overview
  // =========================================================================

  async createVideoOverview(
    notebookId: string,
    options: {
      sourceIds?: string[];
      format?: number;
      visualStyle?: number;
      visualStylePrompt?: string;
      language?: string;
      focusPrompt?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      format = VIDEO_FORMAT.EXPLAINER,
      visualStyle = VIDEO_STYLE.AUTO_SELECT,
      visualStylePrompt = "",
      language = "en",
      focusPrompt = "",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);
    const sourcesSimple = sourceIds.map((sid) => [sid]);

    // Build inner options (cinematic format omits visual style)
    const innerOptions: unknown[] = [sourcesSimple, language, focusPrompt, null, format];
    if (format !== VIDEO_FORMAT.CINEMATIC) {
      innerOptions.push(visualStyle);
      if (visualStylePrompt) {
        innerOptions.push(visualStylePrompt);
      }
    }

    const videoOptions = [null, null, innerOptions];

    const params = [
      [2],
      notebookId,
      [null, null, STUDIO_TYPE.VIDEO, sourcesNested, null, null, null, null, videoOptions],
    ];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "video",
        status: normalizeStudioStatus(artifactData as unknown[]),
        format: getVideoFormatName(format),
        visual_style:
          format !== VIDEO_FORMAT.CINEMATIC ? getVideoStyleName(visualStyle) : null,
        visual_style_prompt: visualStylePrompt || null,
        language,
      };
    }

    return null;
  }

  // =========================================================================
  // Infographic
  // =========================================================================

  async createInfographic(
    notebookId: string,
    options: {
      sourceIds?: string[];
      orientation?: number;
      detailLevel?: number;
      visualStyle?: number;
      language?: string;
      focusPrompt?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      orientation = INFOGRAPHIC_ORIENTATION.LANDSCAPE,
      detailLevel = INFOGRAPHIC_DETAIL.STANDARD,
      visualStyle = INFOGRAPHIC_STYLE.AUTO_SELECT,
      language = "en",
      focusPrompt = "",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);

    const infographicOptions = [
      [focusPrompt || null, language, null, orientation, detailLevel, visualStyle],
    ];

    const content: unknown[] = [
      null, null, STUDIO_TYPE.INFOGRAPHIC, sourcesNested,
      null, null, null, null, null, null, null, null, null, null,
      infographicOptions,
    ];

    const params = [[2], notebookId, content];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "infographic",
        status: normalizeStudioStatus(artifactData as unknown[]),
        orientation: getInfographicOrientationName(orientation),
        detail_level: getInfographicDetailName(detailLevel),
        visual_style: getInfographicStyleName(visualStyle),
        language,
      };
    }

    return null;
  }

  // =========================================================================
  // Slide Deck
  // =========================================================================

  async createSlideDeck(
    notebookId: string,
    options: {
      sourceIds?: string[];
      format?: number;
      length?: number;
      language?: string;
      focusPrompt?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      format = SLIDE_DECK_FORMAT.DETAILED,
      length = SLIDE_DECK_LENGTH.DEFAULT,
      language = "en",
      focusPrompt = "",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);

    const slideDeckOptions = [[focusPrompt || null, language, format, length]];

    const content: unknown[] = [
      null, null, STUDIO_TYPE.SLIDE_DECK, sourcesNested,
      null, null, null, null, null, null, null, null, null, null, null, null,
      slideDeckOptions,
    ];

    const params = [[2], notebookId, content];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "slide_deck",
        status: normalizeStudioStatus(artifactData as unknown[]),
        format: getSlideDeckFormatName(format),
        length: getSlideDeckLengthName(length),
        language,
      };
    }

    return null;
  }

  // =========================================================================
  // Report
  // =========================================================================

  async createReport(
    notebookId: string,
    options: {
      sourceIds?: string[];
      reportFormat?: string;
      customPrompt?: string;
      language?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      reportFormat = "Briefing Doc",
      customPrompt = "",
      language = "en",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);
    const sourcesSimple = sourceIds.map((sid) => [sid]);

    const formatConfigs: Record<string, { title: string; description: string; prompt: string }> = {
      "Briefing Doc": {
        title: "Briefing Doc",
        description: "Key insights and important quotes",
        prompt:
          "Create a comprehensive briefing document that includes an " +
          "Executive Summary, detailed analysis of key themes, important " +
          "quotes with context, and actionable insights.",
      },
      "Study Guide": {
        title: "Study Guide",
        description: "Short-answer quiz, essay questions, glossary",
        prompt:
          "Create a comprehensive study guide that includes key concepts, " +
          "short-answer practice questions, essay prompts for deeper " +
          "exploration, and a glossary of important terms.",
      },
      "Blog Post": {
        title: "Blog Post",
        description: "Insightful takeaways in readable article format",
        prompt:
          "Write an engaging blog post that presents the key insights " +
          "in an accessible, reader-friendly format. Include an attention-" +
          "grabbing introduction, well-organized sections, and a compelling " +
          "conclusion with takeaways.",
      },
      "Create Your Own": {
        title: "Custom Report",
        description: "Custom format",
        prompt: customPrompt || "Create a report based on the provided sources.",
      },
    };

    const config = formatConfigs[reportFormat];
    if (!config) {
      throw new Error(
        `Invalid report format: ${reportFormat}. Valid: ${Object.keys(formatConfigs).join(", ")}`
      );
    }

    const reportOptions = [
      null,
      [config.title, config.description, null, sourcesSimple, language, config.prompt, null, true],
    ];

    const content = [
      null, null, STUDIO_TYPE.REPORT, sourcesNested,
      null, null, null, reportOptions,
    ];

    const params = [[2], notebookId, content];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "report",
        status: normalizeStudioStatus(artifactData as unknown[]),
        format: reportFormat,
        language,
      };
    }

    return null;
  }

  // =========================================================================
  // Flashcards
  // =========================================================================

  async createFlashcards(
    notebookId: string,
    options: {
      sourceIds?: string[];
      difficulty?: number;
      focusPrompt?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      difficulty = FLASHCARD_DIFFICULTY.MEDIUM,
      focusPrompt = "",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);

    const flashcardOptions = [
      null,
      [1, null, focusPrompt || null, null, null, null, [difficulty, FLASHCARD_COUNT_DEFAULT]],
    ];

    const content: unknown[] = [
      null, null, STUDIO_TYPE.FLASHCARDS, sourcesNested,
      null, null, null, null, null,
      flashcardOptions,
    ];

    const params = [[2], notebookId, content];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "flashcards",
        status: normalizeStudioStatus(artifactData as unknown[]),
        difficulty: getFlashcardDifficultyName(difficulty),
      };
    }

    return null;
  }

  // =========================================================================
  // Quiz
  // =========================================================================

  async createQuiz(
    notebookId: string,
    options: {
      sourceIds?: string[];
      questionCount?: number;
      difficulty?: number;
      focusPrompt?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      questionCount = 2,
      difficulty = FLASHCARD_DIFFICULTY.MEDIUM,
      focusPrompt = "",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);

    const quizOptions = [
      null,
      [2, null, focusPrompt || null, null, null, null, null, [questionCount, difficulty]],
    ];

    const content: unknown[] = [
      null, null, STUDIO_TYPE.FLASHCARDS, sourcesNested,
      null, null, null, null, null,
      quizOptions,
    ];

    const params = [[2], notebookId, content];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "quiz",
        status: normalizeStudioStatus(artifactData as unknown[]),
        question_count: questionCount,
        difficulty: getFlashcardDifficultyName(difficulty),
      };
    }

    return null;
  }

  // =========================================================================
  // Data Table
  // =========================================================================

  async createDataTable(
    notebookId: string,
    options: {
      sourceIds?: string[];
      description?: string;
      language?: string;
    } = {}
  ): Promise<StudioArtifact | null> {
    const {
      description = "",
      language = "en",
    } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);

    const datatableOptions = [null, [description, language]];

    const content: unknown[] = [
      null, null, STUDIO_TYPE.DATA_TABLE, sourcesNested,
      null, null, null, null, null, null, null, null, null, null, null, null, null, null,
      datatableOptions,
    ];

    const params = [[2], notebookId, content];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.CREATE_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const artifactData = result[0];
      const artifactId =
        Array.isArray(artifactData) && artifactData.length > 0 ? artifactData[0] : null;

      return {
        artifact_id: artifactId,
        notebook_id: notebookId,
        type: "data_table",
        status: normalizeStudioStatus(artifactData as unknown[]),
        description,
      };
    }

    return null;
  }

  // =========================================================================
  // Mind Map
  // =========================================================================

  async generateMindMap(
    notebookId: string,
    options: {
      sourceIds?: string[];
    } = {}
  ): Promise<{ mind_map_json: string | null; generation_id: string | null; source_ids: string[] } | null> {
    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }
    if (sourceIds.length === 0) {
      throw new Error(`No sources found in notebook ${notebookId}. Add sources first.`);
    }

    const sourcesNested = sourceIds.map((sid) => [[sid]]);

    const params = [
      sourcesNested,
      null, null, null, null,
      ["interactive_mindmap", [["[CONTEXT]", ""]], ""],
      null,
      [2, null, [1]],
    ];

    const result = await this.rpcClient.callRpc(RPC_IDS.GENERATE_MIND_MAP, params);

    if (result && Array.isArray(result) && result.length > 0) {
      const inner = Array.isArray(result[0]) ? result[0] : result;
      const mindMapJson = typeof inner[0] === "string" ? inner[0] : null;
      let generationId: string | null = null;

      if (inner.length > 2 && Array.isArray(inner[2]) && inner[2].length > 0) {
        generationId = inner[2][0];
      }

      return {
        mind_map_json: mindMapJson,
        generation_id: generationId,
        source_ids: sourceIds,
      };
    }

    return null;
  }

  async saveMindMap(
    notebookId: string,
    mindMapJson: string,
    options: {
      sourceIds?: string[];
      title?: string;
    } = {}
  ): Promise<{ mind_map_id: string | null; notebook_id: string; title: string } | null> {
    const { title = "Mind Map" } = options;

    let sourceIds = options.sourceIds;
    if (!sourceIds || sourceIds.length === 0) {
      sourceIds = await this.getSourceIds(notebookId);
    }

    const sourcesSimple = sourceIds.map((sid) => [sid]);
    const metadata = [2, null, null, 5, sourcesSimple];
    const params = [notebookId, mindMapJson, metadata, null, title];

    const result = await this.rpcClient.callRpc(
      RPC_IDS.SAVE_MIND_MAP,
      params,
      `/notebook/${notebookId}`
    );

    if (result && Array.isArray(result) && result.length > 0) {
      const inner = Array.isArray(result[0]) ? result[0] : result;
      const mindMapId = inner.length > 0 ? inner[0] : null;
      const savedTitle = inner.length > 4 ? inner[4] : title;

      return {
        mind_map_id: mindMapId,
        notebook_id: notebookId,
        title: savedTitle ?? title,
      };
    }

    return null;
  }

  // =========================================================================
  // Status & Deletion
  // =========================================================================

  async pollStudioStatus(notebookId: string): Promise<StudioStatusArtifact[]> {
    const params = [[2], notebookId, 'NOT artifact.status = "ARTIFACT_STATUS_SUGGESTED"'];
    const result = await this.rpcClient.callRpc(
      RPC_IDS.POLL_STUDIO,
      params,
      `/notebook/${notebookId}`
    );

    const artifacts: StudioStatusArtifact[] = [];

    if (!result || !Array.isArray(result) || result.length === 0) return artifacts;

    const artifactList = Array.isArray(result[0]) ? result[0] : result;

    for (const artifactData of artifactList) {
      if (!Array.isArray(artifactData) || artifactData.length < 5) continue;

      const artifactId = artifactData[0];
      const title = artifactData[1] ?? "";
      const typeCode = artifactData[2];
      const status = normalizeStudioStatus(artifactData);

      let audioUrl: string | null = null;
      let videoUrl: string | null = null;
      let infographicUrl: string | null = null;
      let slideDeckUrl: string | null = null;
      let reportContent: string | null = null;
      let flashcardCount: number | null = null;
      let durationSeconds: number | null = null;

      // Audio URLs
      if (typeCode === STUDIO_TYPE.AUDIO && artifactData.length > 6) {
        audioUrl = extractAudioMediaUrl(artifactData);
        const audioOptions = artifactData[6];
        if (Array.isArray(audioOptions) && audioOptions.length > 9 && Array.isArray(audioOptions[9])) {
          durationSeconds = audioOptions[9][0] ?? null;
        }
      }

      // Video URLs
      if (typeCode === STUDIO_TYPE.VIDEO && artifactData.length > 8) {
        const videoOptions = artifactData[8];
        if (Array.isArray(videoOptions) && videoOptions.length > 3 && typeof videoOptions[3] === "string") {
          videoUrl = videoOptions[3];
        }
      }

      // Infographic URLs
      if (typeCode === STUDIO_TYPE.INFOGRAPHIC && artifactData.length > 14) {
        const infographicOptions = artifactData[14];
        if (Array.isArray(infographicOptions) && infographicOptions.length > 2) {
          const imageData = infographicOptions[2];
          if (Array.isArray(imageData) && imageData.length > 0) {
            const firstImage = imageData[0];
            if (Array.isArray(firstImage) && firstImage.length > 1) {
              const imageDetails = firstImage[1];
              if (Array.isArray(imageDetails) && imageDetails.length > 0) {
                const url = imageDetails[0];
                if (typeof url === "string" && url.startsWith("http")) {
                  infographicUrl = url;
                }
              }
            }
          }
        }
      }

      // Slide deck URLs
      if (typeCode === STUDIO_TYPE.SLIDE_DECK && artifactData.length > 16) {
        const sdOptions = artifactData[16];
        if (Array.isArray(sdOptions) && sdOptions.length > 0) {
          if (typeof sdOptions[0] === "string" && sdOptions[0].startsWith("http")) {
            slideDeckUrl = sdOptions[0];
          } else if (sdOptions.length > 3 && typeof sdOptions[3] === "string") {
            slideDeckUrl = sdOptions[3];
          }
        }
      }

      // Report content
      if (typeCode === STUDIO_TYPE.REPORT && artifactData.length > 7) {
        const reportOptions = artifactData[7];
        if (Array.isArray(reportOptions) && reportOptions.length > 1) {
          const contentData = Array.isArray(reportOptions[1]) ? reportOptions[1] : null;
          if (contentData && contentData.length > 0 && typeof contentData[0] === "string") {
            reportContent = contentData[0];
          }
        }
      }

      // Flashcard/quiz count
      if (typeCode === STUDIO_TYPE.FLASHCARDS && artifactData.length > 9) {
        const fcOptions = artifactData[9];
        if (Array.isArray(fcOptions) && fcOptions.length > 1) {
          const cardsData = Array.isArray(fcOptions[1]) ? fcOptions[1] : null;
          if (cardsData) {
            flashcardCount = cardsData.length;
          }
        }
      }

      // Determine quiz vs flashcard
      let artifactType = getStudioTypeName(typeCode);
      if (typeCode === STUDIO_TYPE.FLASHCARDS && artifactData.length > 9) {
        const fcOptions = artifactData[9];
        if (Array.isArray(fcOptions) && fcOptions.length > 1) {
          const inner = fcOptions[1];
          if (Array.isArray(inner) && inner.length > 0 && inner[0] === 2) {
            artifactType = "quiz";
          }
        }
      }

      artifacts.push({
        artifact_id: artifactId,
        title,
        type: artifactType,
        status,
        audio_url: audioUrl,
        video_url: videoUrl,
        infographic_url: infographicUrl,
        slide_deck_url: slideDeckUrl,
        report_content: reportContent,
        flashcard_count: flashcardCount,
        duration_seconds: durationSeconds,
      });
    }

    return artifacts;
  }

  async deleteStudioArtifact(artifactId: string): Promise<boolean> {
    try {
      const params = [[2], artifactId];
      const result = await this.rpcClient.callRpc(RPC_IDS.DELETE_STUDIO, params);
      return result !== null;
    } catch {
      return false;
    }
  }
}
