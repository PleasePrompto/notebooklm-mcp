/**
 * Studio Tool Handlers
 *
 * Implements MCP tool handlers for studio artifact generation.
 * Extracts cookies from the Patchright browser session and uses
 * the StudioClient for direct RPC calls to NotebookLM's API.
 */

// BrowserContext type not needed -- we access it via session manager internals
import { StudioClient, extractNotebookId } from "../api/studio-client.js";
import {
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
} from "../api/constants.js";
import type { ToolResult, ProgressCallback } from "../types.js";
import { log } from "../utils/logger.js";
import { SessionManager } from "../session/session-manager.js";

// Name-to-code lookup maps
const AUDIO_FORMAT_MAP: Record<string, number> = {
  deep_dive: AUDIO_FORMAT.DEEP_DIVE,
  brief: AUDIO_FORMAT.BRIEF,
  critique: AUDIO_FORMAT.CRITIQUE,
  debate: AUDIO_FORMAT.DEBATE,
};

const AUDIO_LENGTH_MAP: Record<string, number> = {
  short: AUDIO_LENGTH.SHORT,
  default: AUDIO_LENGTH.DEFAULT,
  long: AUDIO_LENGTH.LONG,
};

const VIDEO_FORMAT_MAP: Record<string, number> = {
  explainer: VIDEO_FORMAT.EXPLAINER,
  brief: VIDEO_FORMAT.BRIEF,
  cinematic: VIDEO_FORMAT.CINEMATIC,
};

const VIDEO_STYLE_MAP: Record<string, number> = {
  auto_select: VIDEO_STYLE.AUTO_SELECT,
  custom: VIDEO_STYLE.CUSTOM,
  classic: VIDEO_STYLE.CLASSIC,
  whiteboard: VIDEO_STYLE.WHITEBOARD,
  kawaii: VIDEO_STYLE.KAWAII,
  anime: VIDEO_STYLE.ANIME,
  watercolor: VIDEO_STYLE.WATERCOLOR,
  retro_print: VIDEO_STYLE.RETRO_PRINT,
  heritage: VIDEO_STYLE.HERITAGE,
  paper_craft: VIDEO_STYLE.PAPER_CRAFT,
};

const INFOGRAPHIC_ORIENTATION_MAP: Record<string, number> = {
  landscape: INFOGRAPHIC_ORIENTATION.LANDSCAPE,
  portrait: INFOGRAPHIC_ORIENTATION.PORTRAIT,
  square: INFOGRAPHIC_ORIENTATION.SQUARE,
};

const INFOGRAPHIC_DETAIL_MAP: Record<string, number> = {
  concise: INFOGRAPHIC_DETAIL.CONCISE,
  standard: INFOGRAPHIC_DETAIL.STANDARD,
  detailed: INFOGRAPHIC_DETAIL.DETAILED,
};

const INFOGRAPHIC_STYLE_MAP: Record<string, number> = {
  auto_select: INFOGRAPHIC_STYLE.AUTO_SELECT,
  sketch_note: INFOGRAPHIC_STYLE.SKETCH_NOTE,
  professional: INFOGRAPHIC_STYLE.PROFESSIONAL,
  bento_grid: INFOGRAPHIC_STYLE.BENTO_GRID,
  editorial: INFOGRAPHIC_STYLE.EDITORIAL,
  instructional: INFOGRAPHIC_STYLE.INSTRUCTIONAL,
  bricks: INFOGRAPHIC_STYLE.BRICKS,
  clay: INFOGRAPHIC_STYLE.CLAY,
  anime: INFOGRAPHIC_STYLE.ANIME,
  kawaii: INFOGRAPHIC_STYLE.KAWAII,
  scientific: INFOGRAPHIC_STYLE.SCIENTIFIC,
};

const SLIDE_DECK_FORMAT_MAP: Record<string, number> = {
  detailed_deck: SLIDE_DECK_FORMAT.DETAILED,
  presenter_slides: SLIDE_DECK_FORMAT.PRESENTER,
};

const SLIDE_DECK_LENGTH_MAP: Record<string, number> = {
  short: SLIDE_DECK_LENGTH.SHORT,
  default: SLIDE_DECK_LENGTH.DEFAULT,
};

const DIFFICULTY_MAP: Record<string, number> = {
  easy: FLASHCARD_DIFFICULTY.EASY,
  medium: FLASHCARD_DIFFICULTY.MEDIUM,
  hard: FLASHCARD_DIFFICULTY.HARD,
};

/**
 * Studio tool handlers.
 */
export class StudioHandlers {
  private sessionManager: SessionManager;
  private studioClient: StudioClient | null = null;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Get or create a StudioClient using the browser context for authenticated API calls.
   */
  private async getStudioClient(notebookUrl: string): Promise<StudioClient> {
    // Get a session to get the browser context
    const session = await this.sessionManager.getOrCreateSession(undefined, notebookUrl);

    if (!this.studioClient) {
      this.studioClient = new StudioClient();
    }

    // Try to get the page from the session
    const page = (session as any).getPage?.();
    if (page) {
      this.studioClient.setPage(page);
      return this.studioClient;
    }

    // Fall back to shared context manager
    const sharedCtxMgr = (this.sessionManager as any).sharedContextManager;
    if (sharedCtxMgr) {
      const ctx = await sharedCtxMgr.getOrCreateContext();
      this.studioClient.setContext(ctx);
      return this.studioClient;
    }

    throw new Error("Could not access browser context for API calls");
  }

  /**
   * Handle studio_create tool
   */
  async handleStudioCreate(
    args: Record<string, unknown>,
    sendProgress?: ProgressCallback
  ): Promise<ToolResult> {
    const notebookUrl = args.notebook_url as string;
    const artifactType = args.artifact_type as string;
    const focusPrompt = (args.focus_prompt as string) || "";
    const language = (args.language as string) || "en";

    log.info(`[STUDIO] Creating ${artifactType} artifact`);
    log.info(`  Notebook: ${notebookUrl}`);

    try {
      const notebookId = extractNotebookId(notebookUrl);
      await sendProgress?.("Initializing studio client...", 1, 4);

      const client = await this.getStudioClient(notebookUrl);
      await sendProgress?.(`Creating ${artifactType} artifact...`, 2, 4);

      let result: unknown;

      switch (artifactType) {
        case "audio":
          result = await client.createAudioOverview(notebookId, {
            format: AUDIO_FORMAT_MAP[args.audio_format as string] ?? AUDIO_FORMAT.DEEP_DIVE,
            length: AUDIO_LENGTH_MAP[args.audio_length as string] ?? AUDIO_LENGTH.DEFAULT,
            language,
            focusPrompt,
          });
          break;

        case "video":
          result = await client.createVideoOverview(notebookId, {
            format: VIDEO_FORMAT_MAP[args.video_format as string] ?? VIDEO_FORMAT.EXPLAINER,
            visualStyle: VIDEO_STYLE_MAP[args.video_style as string] ?? VIDEO_STYLE.AUTO_SELECT,
            visualStylePrompt: (args.video_style_prompt as string) || "",
            language,
            focusPrompt,
          });
          break;

        case "infographic":
          result = await client.createInfographic(notebookId, {
            orientation:
              INFOGRAPHIC_ORIENTATION_MAP[args.infographic_orientation as string] ??
              INFOGRAPHIC_ORIENTATION.LANDSCAPE,
            detailLevel:
              INFOGRAPHIC_DETAIL_MAP[args.infographic_detail as string] ??
              INFOGRAPHIC_DETAIL.STANDARD,
            visualStyle:
              INFOGRAPHIC_STYLE_MAP[args.infographic_style as string] ??
              INFOGRAPHIC_STYLE.AUTO_SELECT,
            language,
            focusPrompt,
          });
          break;

        case "slide_deck":
          result = await client.createSlideDeck(notebookId, {
            format:
              SLIDE_DECK_FORMAT_MAP[args.slide_format as string] ?? SLIDE_DECK_FORMAT.DETAILED,
            length:
              SLIDE_DECK_LENGTH_MAP[args.slide_length as string] ?? SLIDE_DECK_LENGTH.DEFAULT,
            language,
            focusPrompt,
          });
          break;

        case "report":
          result = await client.createReport(notebookId, {
            reportFormat: (args.report_format as string) || "Briefing Doc",
            customPrompt: (args.custom_prompt as string) || focusPrompt,
            language,
          });
          break;

        case "quiz":
          result = await client.createQuiz(notebookId, {
            questionCount: (args.question_count as number) || 2,
            difficulty: DIFFICULTY_MAP[args.difficulty as string] ?? FLASHCARD_DIFFICULTY.MEDIUM,
            focusPrompt,
          });
          break;

        case "flashcards":
          result = await client.createFlashcards(notebookId, {
            difficulty: DIFFICULTY_MAP[args.difficulty as string] ?? FLASHCARD_DIFFICULTY.MEDIUM,
            focusPrompt,
          });
          break;

        case "mind_map": {
          const mmResult = await client.generateMindMap(notebookId);
          if (mmResult?.mind_map_json) {
            const saved = await client.saveMindMap(notebookId, mmResult.mind_map_json, {
              sourceIds: mmResult.source_ids,
              title: focusPrompt || "Mind Map",
            });
            result = {
              type: "mind_map",
              status: "completed",
              notebook_id: notebookId,
              mind_map_id: saved?.mind_map_id,
              title: saved?.title,
              mind_map_json_preview: mmResult.mind_map_json.slice(0, 500) + "...",
            };
          } else {
            result = null;
          }
          break;
        }

        case "data_table":
          result = await client.createDataTable(notebookId, {
            description: (args.table_description as string) || focusPrompt,
            language,
          });
          break;

        default:
          return {
            success: false,
            error: `Unknown artifact type: ${artifactType}`,
          };
      }

      if (!result) {
        return {
          success: false,
          error: `Failed to create ${artifactType} artifact. The API returned no result.`,
        };
      }

      await sendProgress?.(`${artifactType} artifact created successfully!`, 4, 4);
      log.success(`[STUDIO] ${artifactType} artifact created`);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[STUDIO] studio_create failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle studio_status tool
   */
  async handleStudioStatus(args: Record<string, unknown>): Promise<ToolResult> {
    const notebookUrl = args.notebook_url as string;

    log.info(`[STUDIO] Checking studio status`);
    log.info(`  Notebook: ${notebookUrl}`);

    try {
      const notebookId = extractNotebookId(notebookUrl);
      const client = await this.getStudioClient(notebookUrl);
      const artifacts = await client.pollStudioStatus(notebookId);

      log.success(`[STUDIO] Found ${artifacts.length} artifacts`);

      return {
        success: true,
        data: {
          notebook_id: notebookId,
          artifact_count: artifacts.length,
          artifacts,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[STUDIO] studio_status failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Handle studio_delete tool
   */
  async handleStudioDelete(args: Record<string, unknown>): Promise<ToolResult> {
    const artifactId = args.artifact_id as string;

    log.info(`[STUDIO] Deleting artifact ${artifactId}`);

    try {
      if (!this.studioClient) {
        // Try to initialize from an existing session
        const sessions = this.sessionManager.getAllSessionsInfo();
        if (sessions.length === 0) {
          return {
            success: false,
            error: "No active sessions. Please use studio_status or studio_create first to establish a connection.",
          };
        }
        await this.getStudioClient(sessions[0].notebook_url);
      }

      const client = this.studioClient!;

      const deleted = await client.deleteStudioArtifact(artifactId);

      if (deleted) {
        log.success(`[STUDIO] Artifact ${artifactId} deleted`);
        return {
          success: true,
          data: { deleted: true, artifact_id: artifactId },
        };
      } else {
        return {
          success: false,
          error: `Failed to delete artifact ${artifactId}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[STUDIO] studio_delete failed: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
