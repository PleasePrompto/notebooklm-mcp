/**
 * Studio MCP Tool Definitions
 *
 * Defines all studio artifact generation tools for the MCP server.
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const studioCreateTool: Tool = {
  name: "studio_create",
  description:
    "Create a studio artifact in a NotebookLM notebook. Supports: audio (podcast), video, infographic, slide_deck, report, quiz, flashcards, mind_map, data_table. " +
    "Each type has specific options for format, style, difficulty, etc. The artifact is generated asynchronously - use studio_status to check progress.",
  inputSchema: {
    type: "object" as const,
    properties: {
      notebook_url: {
        type: "string",
        description: "NotebookLM notebook URL (e.g., https://notebooklm.google.com/notebook/<id>)",
      },
      artifact_type: {
        type: "string",
        enum: [
          "audio",
          "video",
          "infographic",
          "slide_deck",
          "report",
          "quiz",
          "flashcards",
          "mind_map",
          "data_table",
        ],
        description: "Type of studio artifact to create",
      },
      focus_prompt: {
        type: "string",
        description:
          "Optional focus prompt to guide artifact generation. Works for all types. " +
          "E.g., 'Focus on the 9 Pillars of Wha-Dho' or 'Explain the business funnel'",
      },
      // Audio options
      audio_format: {
        type: "string",
        enum: ["deep_dive", "brief", "critique", "debate"],
        description: "Audio format (default: deep_dive). Only for audio type.",
      },
      audio_length: {
        type: "string",
        enum: ["short", "default", "long"],
        description: "Audio length (default: default). Only for audio type.",
      },
      // Video options
      video_format: {
        type: "string",
        enum: ["explainer", "brief", "cinematic"],
        description: "Video format/depth (default: explainer). Only for video type.",
      },
      video_style: {
        type: "string",
        enum: [
          "auto_select",
          "classic",
          "whiteboard",
          "kawaii",
          "anime",
          "watercolor",
          "retro_print",
          "heritage",
          "paper_craft",
        ],
        description: "Visual style (default: auto_select). Only for video type.",
      },
      video_style_prompt: {
        type: "string",
        description: "Custom visual style description. Only for video type with custom style.",
      },
      // Infographic options
      infographic_orientation: {
        type: "string",
        enum: ["landscape", "portrait", "square"],
        description: "Infographic orientation (default: landscape). Only for infographic type.",
      },
      infographic_detail: {
        type: "string",
        enum: ["concise", "standard", "detailed"],
        description: "Detail level (default: standard). Only for infographic type.",
      },
      infographic_style: {
        type: "string",
        enum: [
          "auto_select",
          "sketch_note",
          "professional",
          "bento_grid",
          "editorial",
          "instructional",
          "bricks",
          "clay",
          "anime",
          "kawaii",
          "scientific",
        ],
        description: "Visual style (default: auto_select). Only for infographic type.",
      },
      // Slide deck options
      slide_format: {
        type: "string",
        enum: ["detailed_deck", "presenter_slides"],
        description: "Slide format (default: detailed_deck). Only for slide_deck type.",
      },
      slide_length: {
        type: "string",
        enum: ["short", "default"],
        description: "Slide deck length (default: default). Only for slide_deck type.",
      },
      // Report options
      report_format: {
        type: "string",
        enum: ["Briefing Doc", "Study Guide", "Blog Post", "Create Your Own"],
        description: "Report format (default: Briefing Doc). Only for report type.",
      },
      custom_prompt: {
        type: "string",
        description:
          "Custom prompt for 'Create Your Own' report format. Also used as directive for tailored reports.",
      },
      // Quiz/Flashcard options
      difficulty: {
        type: "string",
        enum: ["easy", "medium", "hard"],
        description: "Difficulty level (default: medium). For quiz and flashcards types.",
      },
      question_count: {
        type: "number",
        description: "Number of questions (default: 2). Only for quiz type.",
      },
      // Data table options
      table_description: {
        type: "string",
        description: "Description of the data table to create. Only for data_table type.",
      },
      // Language
      language: {
        type: "string",
        description: "Language code (default: en)",
      },
    },
    required: ["notebook_url", "artifact_type"],
  },
};

export const studioStatusTool: Tool = {
  name: "studio_status",
  description:
    "Check the status of all studio artifacts in a NotebookLM notebook. " +
    "Returns artifact IDs, types, status (in_progress/completed/failed), and download URLs when available.",
  inputSchema: {
    type: "object" as const,
    properties: {
      notebook_url: {
        type: "string",
        description: "NotebookLM notebook URL",
      },
    },
    required: ["notebook_url"],
  },
};

export const studioDeleteTool: Tool = {
  name: "studio_delete",
  description: "Delete a studio artifact from a NotebookLM notebook. This action is IRREVERSIBLE.",
  inputSchema: {
    type: "object" as const,
    properties: {
      artifact_id: {
        type: "string",
        description: "The artifact UUID to delete",
      },
    },
    required: ["artifact_id"],
  },
};

export const studioTools: Tool[] = [studioCreateTool, studioStatusTool, studioDeleteTool];
