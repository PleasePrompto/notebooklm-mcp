/**
 * Stealth utilities for human-like browser behavior
 *
 * This module provides functions to simulate realistic human interactions:
 * - Human-like typing (speed configurable via CONFIG.typingWpmMin/Max)
 * - Realistic mouse movements (Bezier curves with jitter)
 * - Random delays (normal distribution)
 * - Smooth scrolling
 * - Reading pauses
 *
 * Based on the Python implementation from stealth_utils.py
 */

import type { Page } from "patchright";
import { CONFIG } from "../config.js";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sleep for specified milliseconds
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate random float between min and max
 */
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

/**
 * Generate random character (for typos)
 */
export function randomChar(): string {
  const chars = "qwertyuiopasdfghjklzxcvbnm";
  return chars[randomInt(0, chars.length - 1)];
}

/**
 * Generate Gaussian (normal) distributed random number
 * Uses Box-Muller transform
 */
export function gaussian(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

// ============================================================================
// Random Delays
// ============================================================================

/**
 * Add a random delay to simulate human thinking/reaction time
 * Uses normal distribution for more realistic delays
 *
 * @param minMs Minimum delay in milliseconds (default: from CONFIG)
 * @param maxMs Maximum delay in milliseconds (default: from CONFIG)
 */
export async function randomDelay(
  minMs?: number,
  maxMs?: number
): Promise<void> {
  minMs = minMs ?? CONFIG.minDelayMs;
  maxMs = maxMs ?? CONFIG.maxDelayMs;

  if (!CONFIG.stealthEnabled || !CONFIG.stealthRandomDelays) {
    // Fixed delay (average)
    const target = minMs === maxMs ? minMs : (minMs + maxMs) / 2;
    if (target > 0) {
      await sleep(target);
    }
    return;
  }

  // Use normal distribution for more realistic delays
  // Mean at 60% of range, standard deviation of 20% of range
  const mean = minMs + (maxMs - minMs) * 0.6;
  const stdDev = (maxMs - minMs) * 0.2;

  let delay = gaussian(mean, stdDev);
  delay = Math.max(minMs, Math.min(maxMs, delay)); // Clamp to range

  await sleep(delay);
}

// ============================================================================
// Human Typing
// ============================================================================

/**
 * Type text in a human-like manner with variable speed and optional typos
 *
 * Simulates realistic typing patterns:
 * - Variable speed (45-65 WPM by default)
 * - Occasional typos (2% chance)
 * - Longer pauses after punctuation
 * - Realistic character delays
 *
 * @param page Playwright page instance
 * @param selector CSS selector of input element
 * @param text Text to type
 * @param options Typing options (wpm, withTypos)
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  options: {
    wpm?: number;
    withTypos?: boolean;
  } = {}
): Promise<void> {
  if (!CONFIG.stealthEnabled || !CONFIG.stealthHumanTyping) {
    // Fast typing without stealth
    await page.fill(selector, text);
    return;
  }

  const wpm = options.wpm ?? randomInt(CONFIG.typingWpmMin, CONFIG.typingWpmMax);
  const withTypos = options.withTypos ?? true;

  // Calculate average delay per character (in ms)
  // WPM = (characters / 5) / minutes
  // Average word length ~5 characters
  const charsPerMinute = wpm * 5;
  const avgDelayMs = (60 * 1000) / charsPerMinute;

  // Clear existing text first
  await page.fill(selector, "");
  await randomDelay(30, 80);

  // Click to focus
  await page.click(selector);
  await randomDelay(20, 60);

  // Type each character
  let currentText = "";
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    // Simulate very rare typo (0.3% chance) and shorter correction
    if (withTypos && Math.random() < 0.003 && i > 0) {
      // Type wrong character
      const wrongChar = randomChar();
      currentText += wrongChar;
      await page.fill(selector, currentText);

      // Shorter notice window for faster typing
      const noticeDelay = randomFloat(avgDelayMs * 0.6, avgDelayMs * 1.1);
      await sleep(noticeDelay);

      // Backspace
      currentText = currentText.slice(0, -1);
      await page.fill(selector, currentText);
      await randomDelay(20, 60);
    }

    // Type correct character
    currentText += char;
    await page.fill(selector, currentText);

    // Variable delay between characters – tuned for faster but still human-like typing
    let delay: number;
    if (char === "." || char === "!" || char === "?") {
      delay = randomFloat(avgDelayMs * 1.05, avgDelayMs * 1.4);
    } else if (char === " ") {
      delay = randomFloat(avgDelayMs * 0.5, avgDelayMs * 0.9);
    } else if (char === ",") {
      delay = randomFloat(avgDelayMs * 0.9, avgDelayMs * 1.2);
    } else {
      // Normal character
      const variation = randomFloat(0.5, 0.9);
      delay = avgDelayMs * variation;
    }

    await sleep(delay);
    i++;
  }

  // Small delay after finishing typing
  await randomDelay(50, 120);
}

// ============================================================================
// Mouse Movement
// ============================================================================

/**
 * Move mouse in a realistic curved path to target coordinates
 * Uses Bezier-like curves with jitter for natural movement
 *
 * @param page Playwright page instance
 * @param targetX Target X coordinate (default: random)
 * @param targetY Target Y coordinate (default: random)
 * @param steps Number of steps in movement (default: random 10-25)
 */
export async function randomMouseMovement(
  page: Page,
  targetX?: number,
  targetY?: number,
  steps?: number
): Promise<void> {
  if (!CONFIG.stealthEnabled || !CONFIG.stealthMouseMovements) {
    return;
  }

  const viewport = page.viewportSize() || CONFIG.viewport;

  targetX = targetX ?? randomInt(100, viewport.width - 100);
  targetY = targetY ?? randomInt(100, viewport.height - 100);
  steps = steps ?? randomInt(10, 25);

  // Start from a random position (we don't know current position)
  const startX = randomInt(0, viewport.width);
  const startY = randomInt(0, viewport.height);

  // Generate curved path using Bezier-like curve
  for (let step = 0; step < steps; step++) {
    const progress = step / steps;

    // Add some randomness to create a natural curve
    const curveOffsetX = Math.sin(progress * Math.PI) * randomInt(-50, 50);
    const curveOffsetY = Math.cos(progress * Math.PI) * randomInt(-30, 30);

    let currentX = startX + (targetX - startX) * progress + curveOffsetX;
    let currentY = startY + (targetY - startY) * progress + curveOffsetY;

    // Add micro-jitter (humans never move in perfectly straight lines)
    const jitterX = randomFloat(-3, 3);
    const jitterY = randomFloat(-3, 3);

    currentX = Math.max(0, Math.min(viewport.width, currentX + jitterX));
    currentY = Math.max(0, Math.min(viewport.height, currentY + jitterY));

    await page.mouse.move(currentX, currentY);

    // Variable delay between movements (faster in middle, slower at ends)
    const delay = 10 + 20 * Math.abs(0.5 - progress);
    await sleep(delay);
  }
}

// ============================================================================
// Realistic Click
// ============================================================================

/**
 * Click an element with realistic human behavior
 * Includes mouse movement, pause, and click
 *
 * @param page Playwright page instance
 * @param selector CSS selector of element to click
 * @param withMouseMovement Whether to move mouse first (default: true)
 */
export async function realisticClick(
  page: Page,
  selector: string,
  withMouseMovement: boolean = true
): Promise<void> {
  if (!CONFIG.stealthEnabled || !CONFIG.stealthMouseMovements) {
    await page.click(selector);
    return;
  }

  if (withMouseMovement) {
    // Move mouse to element
    const element = await page.$(selector);
    if (element) {
      const box = await element.boundingBox();
      if (box) {
        // Don't click exactly in center (humans are imperfect)
        const offsetX = randomFloat(-box.width * 0.2, box.width * 0.2);
        const offsetY = randomFloat(-box.height * 0.2, box.height * 0.2);

        const targetX = box.x + box.width / 2 + offsetX;
        const targetY = box.y + box.height / 2 + offsetY;

        await randomMouseMovement(page, targetX, targetY);
      }
    }
  }

  // Small pause before clicking
  await randomDelay(100, 300);

  // Click
  await page.click(selector);

  // Small pause after clicking
  await randomDelay(150, 400);
}

// ============================================================================
// Smooth Scrolling
// ============================================================================

/**
 * Scroll the page smoothly like a human
 * Uses multiple small steps for smooth animation
 *
 * @param page Playwright page instance
 * @param amount Scroll amount in pixels (default: random 100-400)
 * @param direction Scroll direction ("down" or "up")
 */
export async function smoothScroll(
  page: Page,
  amount?: number,
  direction: "up" | "down" = "down"
): Promise<void> {
  amount = amount ?? randomInt(100, 400);
  amount = Math.abs(amount);
  if (direction === "up") {
    amount = -amount;
  }

  if (!CONFIG.stealthEnabled || !CONFIG.stealthMouseMovements) {
    await page.evaluate((scrollAmount) => {
      // @ts-expect-error - window exists in browser context
      window.scrollBy({ top: scrollAmount, behavior: "auto" });
    }, amount);
    return;
  }

  // Scroll in multiple small steps for smoothness
  const steps = randomInt(8, 15);
  const stepAmount = amount / steps;

  for (let i = 0; i < steps; i++) {
    await page.evaluate((step) => {
      // @ts-expect-error - window exists in browser context
      window.scrollBy({ top: step, behavior: "smooth" });
    }, stepAmount);
    await sleep(randomFloat(20, 50));
  }

  // Pause after scrolling (humans look at content)
  await randomDelay(300, 800);
}

// ============================================================================
// Reading Simulation
// ============================================================================

/**
 * Pause as if reading text, based on length
 * Calculates realistic reading time based on text length and WPM
 *
 * @param textLength Number of characters to "read"
 * @param wpm Reading speed in words per minute (default: random 200-250)
 */
export async function readingPause(textLength: number, wpm?: number): Promise<void> {
  if (!CONFIG.stealthEnabled || !CONFIG.stealthRandomDelays) {
    return;
  }

  wpm = wpm ?? randomInt(200, 250);

  // Calculate reading time
  // Average word length ~5 characters
  const wordCount = textLength / 5;
  const minutes = wordCount / wpm;
  let seconds = minutes * 60;

  // Add some randomness (humans don't read at constant speed)
  seconds *= randomFloat(0.8, 1.2);

  // Cap at reasonable maximum (3 seconds)
  seconds = Math.min(seconds, 3.0);

  await sleep(seconds * 1000);
}

// ============================================================================
// Random Mouse Jitter
// ============================================================================

/**
 * Add small random mouse movements to simulate natural fidgeting
 *
 * @param page Playwright page instance
 * @param iterations Number of small movements (default: 3)
 */
export async function randomMouseJitter(
  page: Page,
  iterations: number = 3
): Promise<void> {
  if (!CONFIG.stealthEnabled || !CONFIG.stealthMouseMovements) {
    return;
  }

  const viewport = page.viewportSize() || CONFIG.viewport;

  for (let i = 0; i < iterations; i++) {
    const targetX = randomInt(0, viewport.width);
    const targetY = randomInt(0, viewport.height);
    await page.mouse.move(targetX, targetY, { steps: randomInt(2, 4) });
    await sleep(randomFloat(100, 300));
  }
}

// ============================================================================
// Hover Element
// ============================================================================

/**
 * Hover over an element with realistic mouse movement
 *
 * @param page Playwright page instance
 * @param selector CSS selector of element to hover
 */
export async function hoverElement(page: Page, selector: string): Promise<void> {
  if (!CONFIG.stealthEnabled || !CONFIG.stealthMouseMovements) {
    await page.hover(selector);
    return;
  }

  const element = await page.$(selector);
  if (element) {
    const box = await element.boundingBox();
    if (box) {
      // Move to center of element
      const targetX = box.x + box.width / 2;
      const targetY = box.y + box.height / 2;

      await randomMouseMovement(page, targetX, targetY);
      await page.hover(selector);
      await randomDelay(200, 500);
    }
  }
}

// ============================================================================
// Simulate Reading Page
// ============================================================================

/**
 * Simulate reading a page with scrolling and pauses
 * Adds realistic behavior of scrolling and reading content
 *
 * @param page Playwright page instance
 */
export async function simulateReadingPage(page: Page): Promise<void> {
  if (!CONFIG.stealthEnabled || !CONFIG.stealthRandomDelays) {
    return;
  }

  // Random number of scroll actions
  const scrollCount = randomInt(1, 3);

  for (let i = 0; i < scrollCount; i++) {
    // Scroll down
    await smoothScroll(page, undefined, "down");

    // "Read" the visible content
    await randomDelay(800, 1500);

    // Sometimes scroll up a bit (humans do this)
    if (Math.random() < 0.3) {
      await smoothScroll(page, randomInt(50, 150), "up");
      await randomDelay(400, 800);
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

export default {
  sleep,
  randomInt,
  randomFloat,
  randomChar,
  gaussian,
  randomDelay,
  humanType,
  randomMouseMovement,
  realisticClick,
  smoothScroll,
  readingPause,
  randomMouseJitter,
  hoverElement,
  simulateReadingPage,
};
