#!/usr/bin/env bun
/**
 * Test script for studio artifact generation.
 * Tests against Paul D'Souza's "Way of Harmony" notebook.
 *
 * Uses the persistent Chrome profile and executes API calls from within
 * the browser context for proper cookie handling.
 */

import path from "path";
import { chromium } from "patchright";
import { StudioClient, extractNotebookId } from "./src/api/studio-client.js";

const NOTEBOOK_URL = "https://notebooklm.google.com/notebook/51e20bb8-b012-45d8-9421-0fc6c6f338fa";
const NOTEBOOK_ID = extractNotebookId(NOTEBOOK_URL);
const CHROME_PROFILE = path.join(
  process.env.HOME || "~",
  "Library/Application Support/notebooklm-mcp/chrome_profile"
);

// Track results
const results: Record<string, { success: boolean; error?: string; data?: any }> = {};

async function testArtifact(name: string, fn: () => Promise<any>) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing: ${name}`);
  console.log("=".repeat(60));

  try {
    const result = await fn();
    const preview = JSON.stringify(result, null, 2);
    console.log(`SUCCESS: ${preview.length > 500 ? preview.slice(0, 500) + "..." : preview}`);
    results[name] = { success: true, data: result };
  } catch (error: any) {
    console.log(`FAILED: ${error.message}`);
    results[name] = { success: false, error: error.message };
  }
}

async function main() {
  console.log("Launching persistent Chrome context...");
  const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: true,
    channel: "chrome",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  // Navigate to NotebookLM
  const page = await context.newPage();
  console.log("Navigating to NotebookLM...");
  await page.goto("https://notebooklm.google.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const finalUrl = page.url();
  if (finalUrl.includes("accounts.google.com")) {
    console.error("Auth expired. Run setup_auth to re-authenticate.");
    await context.close();
    process.exit(1);
  }
  console.log(`Authenticated! On: ${finalUrl}`);
  console.log(`Notebook ID: ${NOTEBOOK_ID}`);

  // Create StudioClient with the browser page
  const client = new StudioClient();
  client.setPage(page);

  // Verify connectivity
  console.log("\nVerifying API connectivity via studio status...");
  try {
    const status = await client.pollStudioStatus(NOTEBOOK_ID);
    console.log(`Connected! Found ${status.length} existing artifacts.`);
    for (const a of status) {
      console.log(`  - ${a.type}: ${a.title} [${a.status}]`);
    }
  } catch (error: any) {
    console.log(`Connectivity check failed: ${error.message}`);
    console.log("Attempting to continue with tests anyway...");
  }

  // Test 1: Mind Map of the 9 Pillars of Wha-Dho
  await testArtifact("Mind Map - 9 Pillars of Wha-Dho", () =>
    client.generateMindMap(NOTEBOOK_ID).then(async (result) => {
      if (result?.mind_map_json) {
        const saved = await client.saveMindMap(NOTEBOOK_ID, result.mind_map_json, {
          title: "9 Pillars of Wha-Dho",
        });
        return { generated: !!result.mind_map_json, saved };
      }
      return result;
    })
  );

  // Test 2: Whiteboard-style video overview
  await testArtifact("Video Overview - Whiteboard Style", () =>
    client.createVideoOverview(NOTEBOOK_ID, {
      format: 1, // explainer
      visualStyle: 4, // whiteboard
      focusPrompt: "Paul DeSouza's business philosophy and the Way of Harmony",
    })
  );

  // Test 3: Slides for the 3-layer framework
  await testArtifact("Slide Deck - 3-Layer Framework", () =>
    client.createSlideDeck(NOTEBOOK_ID, {
      focusPrompt: "The 3-layer framework: Wha-Dho, EUM, OpenExO",
    })
  );

  // Test 4: Infographic of business funnel
  await testArtifact("Infographic - Business Funnel", () =>
    client.createInfographic(NOTEBOOK_ID, {
      orientation: 2, // portrait
      detailLevel: 3, // detailed
      visualStyle: 3, // professional
      focusPrompt: "Paul DeSouza's business funnel and coaching pipeline",
    })
  );

  // Test 5: Audio deep dive on teaching metaphors
  await testArtifact("Audio Overview - Deep Dive on Teaching Metaphors", () =>
    client.createAudioOverview(NOTEBOOK_ID, {
      format: 1, // deep_dive
      length: 2, // default
      focusPrompt: "Paul DeSouza's teaching metaphors and how they connect to his philosophy",
    })
  );

  // Test 6: Quiz on the Wha-Dho philosophy
  await testArtifact("Quiz - Wha-Dho Philosophy", () =>
    client.createQuiz(NOTEBOOK_ID, {
      difficulty: 2, // medium
      questionCount: 5,
      focusPrompt: "The Wha-Dho philosophy and its core principles",
    })
  );

  // Test 7: Flashcards for key terminology
  await testArtifact("Flashcards - Key Terminology", () =>
    client.createFlashcards(NOTEBOOK_ID, {
      difficulty: 2, // medium
      focusPrompt: "Key terms and concepts from Paul DeSouza's teachings",
    })
  );

  // Test 8: Tailored report for potential coaching clients
  await testArtifact("Report - Coaching Client Overview", () =>
    client.createReport(NOTEBOOK_ID, {
      reportFormat: "Create Your Own",
      customPrompt:
        "Create a compelling overview of Paul DeSouza's coaching practice for potential clients. " +
        "Include his philosophy, methodology (Wha-Dho), what clients can expect, and the transformation journey. " +
        "Write in a warm, inviting tone that reflects Paul's conscious business approach.",
    })
  );

  // Test 9: Data table
  await testArtifact("Data Table - Key Concepts", () =>
    client.createDataTable(NOTEBOOK_ID, {
      description: "Key concepts, their definitions, and which pillar they belong to in the Wha-Dho framework",
    })
  );

  // Wait a moment then check status
  console.log("\nWaiting 10 seconds before checking final status...");
  await new Promise((r) => setTimeout(r, 10000));

  console.log(`\n${"=".repeat(60)}`);
  console.log("Final Studio Status Check");
  console.log("=".repeat(60));

  try {
    const status = await client.pollStudioStatus(NOTEBOOK_ID);
    console.log(`Found ${status.length} artifacts:`);
    for (const a of status) {
      console.log(`  - [${a.status.padEnd(12)}] ${a.type.padEnd(14)} ${a.title}`);
      if (a.audio_url) console.log(`    Audio URL: ${a.audio_url.slice(0, 80)}...`);
      if (a.video_url) console.log(`    Video URL: ${a.video_url.slice(0, 80)}...`);
      if (a.infographic_url) console.log(`    Infographic URL: ${a.infographic_url.slice(0, 80)}...`);
    }
  } catch (error: any) {
    console.log(`Status check failed: ${error.message}`);
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  for (const [name, result] of Object.entries(results)) {
    const icon = result.success ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${name}${result.error ? ` -- ${result.error}` : ""}`);
    if (result.success) passed++;
    else failed++;
  }

  console.log(`\n  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);

  await context.close();
}

main().catch(console.error);
