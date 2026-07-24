import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "patchright";
import { CONFIG } from "../dist/config.js";

const claudeDesktopDataDir = path.join(
  os.homedir(),
  "AppData",
  "Local",
  "Packages",
  "Claude_pzs8sxrjxfjjc",
  "LocalCache",
  "Local",
  "notebooklm-mcp",
  "Data"
);
const candidateDataDirs = [
  process.env.NOTEBOOKLM_DATA_DIR,
  CONFIG.dataDir,
  claudeDesktopDataDir,
].filter(Boolean);
let dataDir;

for (const candidate of candidateDataDirs) {
  try {
    await fs.access(path.join(candidate, "library.json"));
    dataDir = candidate;
    break;
  } catch {
    // Try the next known host-specific data location.
  }
}

if (!dataDir) {
  throw new Error(`Could not locate library.json in: ${candidateDataDirs.join(", ")}`);
}

const libraryPath = path.join(dataDir, "library.json");
const statePath = path.join(dataDir, "browser_state", "state.json");
const library = JSON.parse(await fs.readFile(libraryPath, "utf8"));
const activeNotebook = library.notebooks.find(
  (notebook) => notebook.id === library.active_notebook_id
);

if (!activeNotebook) {
  throw new Error(`No active notebook found in ${libraryPath}`);
}

let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}

const context = await browser.newContext({
  storageState: statePath,
  viewport: CONFIG.viewport,
});
const page = await context.newPage();

function compactText(value, maxLength = 240) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function inspectChat() {
  return await page.evaluate(() => {
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(),
      className: element.className || "",
      ariaLabel: element.getAttribute("aria-label"),
      role: element.getAttribute("role"),
      title: element.getAttribute("title"),
    });

    const answerContainers = Array.from(document.querySelectorAll(".to-user-container"));
    const answerTexts = Array.from(
      document.querySelectorAll(".to-user-container .message-text-content")
    );
    const assistantMessages = answerContainers.map((element) => {
      const textElement = element.querySelector(".message-text-content");
      return {
        text: (textElement?.innerText || textElement?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240),
        hasActions: Boolean(element.querySelector(".message-actions")),
        actionText: (element.querySelector(".message-actions")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120),
        citationCount: element.querySelectorAll(".citation-marker").length,
        directChildren: Array.from(
          element.querySelector(".to-user-message-card-content")?.children || []
        ).map((child) => ({
          ...describe(child),
          text: (child.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        })),
      };
    });
    const chatMessages = Array.from(document.querySelectorAll("chat-message"));
    const textareas = Array.from(document.querySelectorAll("textarea"));
    const submitButtons = Array.from(
      document.querySelectorAll("button.submit-button, button[class*='submit'], button[class*='stop']")
    ).map((element) => ({
      ...describe(element),
      disabled: element.disabled,
      text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
    }));
    const generationSignals = Array.from(
      document.querySelectorAll(
        "[aria-busy='true'], mat-spinner, mat-progress-spinner, [class*='thinking'], [class*='loading'], [class*='generating']"
      )
    )
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => ({
        ...describe(element),
        text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      }));
    const latestAnswerElement = answerContainers.at(-1);
    const latestAnswerStructure = latestAnswerElement
      ? Array.from(latestAnswerElement.querySelectorAll("*"))
          .filter((element) =>
            /message|answer|reason|think|loading|response|content|citation/i.test(
              `${element.tagName} ${element.className || ""}`
            )
          )
          .slice(-30)
          .map((element) => ({
            ...describe(element),
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
          }))
      : [];
    const controls = Array.from(
      document.querySelectorAll("button, [role='button'], [aria-label], [title]")
    )
      .map((element) => ({
        ...describe(element),
        text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      }))
      .filter((item) =>
        /chat|conversation|new|reset|clear|history|mensaje|conversaci|nuevo|reinici/i.test(
          `${item.ariaLabel || ""} ${item.title || ""} ${item.text}`
        )
      );

    return {
      url: location.href,
      answerContainerCount: answerContainers.length,
      answerTextCount: answerTexts.length,
      latestAnswer: (answerTexts.at(-1)?.textContent || "").slice(0, 500),
      assistantMessages: assistantMessages.slice(-6),
      chatMessages: chatMessages.slice(-6).map((element) => ({
        ...describe(element),
        children: Array.from(element.children).map(describe),
        text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
      })),
      answerContainer: answerContainers.at(-1)
        ? {
            ...describe(answerContainers.at(-1)),
            parent: answerContainers.at(-1).parentElement
              ? describe(answerContainers.at(-1).parentElement)
              : null,
            children: Array.from(answerContainers.at(-1).children).map(describe),
          }
        : null,
      textareas: textareas.map((element) => ({
        ...describe(element),
        valueLength: element.value.length,
        placeholder: element.getAttribute("placeholder"),
      })),
      submitButtons,
      generationSignals,
      latestAnswerStructure,
      possibleChatControls: controls,
    };
  });
}

async function settleChatHistory() {
  const jumpButton = page.locator("button.jump-to-bottom-button");
  if ((await jumpButton.count()) > 0 && (await jumpButton.isVisible().catch(() => false))) {
    await jumpButton.click();
  }

  const latestMessage = page.locator("chat-message").last();
  if ((await latestMessage.count()) > 0) {
    await latestMessage.scrollIntoViewIfNeeded().catch(() => undefined);
  }

  const deadline = Date.now() + 15_000;
  let previousSignature = "";
  let stablePolls = 0;

  while (Date.now() < deadline) {
    const current = await inspectChat();
    const signature = [
      current.answerContainerCount,
      current.answerTextCount,
      compactText(current.latestAnswer, 160),
    ].join("|");

    if (signature === previousSignature) {
      stablePolls++;
      if (stablePolls >= 6) return current;
    } else {
      previousSignature = signature;
      stablePolls = 1;
    }
    await page.waitForTimeout(500);
  }

  return await inspectChat();
}

try {
  await page.goto(activeNotebook.url, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("textarea.query-box-input", {
    state: "visible",
    timeout: 60_000,
  });

  const before = await settleChatHistory();
  const latestAnswerLocator = page.locator(
    ".to-user-container:last-of-type .message-text-content"
  );
  console.log(
    JSON.stringify(
      {
        ...before,
        latestAnswer: compactText(before.latestAnswer),
      },
      null,
      2
    )
  );

  if (process.argv.includes("--html") && (await latestAnswerLocator.count()) > 0) {
    console.log(
      JSON.stringify(
        {
          latestAnswerInnerText: await latestAnswerLocator.last().innerText(),
          latestAnswerHtml: await latestAnswerLocator.last().innerHTML(),
        },
        null,
        2
      )
    );
  }

  if (process.argv.includes("--probe")) {
    const marker = `DOM probe ${Date.now()}: responde únicamente con la palabra ESTRUCTURA.`;
    const input = page.locator("textarea.query-box-input");
    await input.fill(marker);
    await input.press("Enter");

    const transitions = [];
    const deadline = Date.now() + 120_000;
    let lastSignature = "";
    let finalState = before;
    let stableAnswerPolls = 0;
    let lastAnswer = "";

    while (Date.now() < deadline) {
      const current = await inspectChat();
      const signature = [
        current.answerContainerCount,
        current.answerTextCount,
        compactText(current.latestAnswer, 80),
      ].join("|");

      if (signature !== lastSignature) {
        const latestAssistant = current.assistantMessages.at(-1);
        transitions.push({
          elapsedMs: 120_000 - (deadline - Date.now()),
          answerContainerCount: current.answerContainerCount,
          answerTextCount: current.answerTextCount,
          latestAnswer: compactText(current.latestAnswer),
          latestHasActions: latestAssistant?.hasActions ?? false,
          submitButtons: current.submitButtons,
          generationSignals: current.generationSignals,
        });
        lastSignature = signature;
      }

      finalState = current;
      const hasNewAnswer =
        current.answerTextCount > before.answerTextCount &&
        compactText(current.latestAnswer) !== compactText(before.latestAnswer);
      const looksLikePlaceholder =
        current.latestAnswer.length < 120 && current.latestAnswer.trim().endsWith("...");
      const hasFinalActions = current.assistantMessages.at(-1)?.hasActions === true;

      if (hasNewAnswer && !looksLikePlaceholder && hasFinalActions) {
        if (current.latestAnswer === lastAnswer) {
          stableAnswerPolls++;
          if (stableAnswerPolls >= 6) break;
        } else {
          lastAnswer = current.latestAnswer;
          stableAnswerPolls = 1;
        }
      } else {
        stableAnswerPolls = 0;
        lastAnswer = "";
      }
      await page.waitForTimeout(500);
    }

    console.log(
      JSON.stringify(
        {
          probe: marker,
          inputCleared: (await input.inputValue()) === "",
          transitions,
          final: {
            answerContainerCount: finalState.answerContainerCount,
            answerTextCount: finalState.answerTextCount,
            latestAnswer: compactText(finalState.latestAnswer),
            latestAssistant: finalState.assistantMessages.at(-1),
            submitButtons: finalState.submitButtons,
            generationSignals: finalState.generationSignals,
          },
        },
        null,
        2
      )
    );
  }

  if (process.argv.includes("--menu")) {
    const menuButton = page.getByRole("button", { name: "Opciones de chat" });
    await menuButton.click();
    await page.waitForTimeout(300);
    const menuItems = await page
      .locator("[role='menuitem'], .mat-mdc-menu-item")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: element.className || "",
          ariaLabel: element.getAttribute("aria-label"),
          role: element.getAttribute("role"),
          text: (element.textContent || "").replace(/\s+/g, " ").trim(),
        }))
      );
    console.log(JSON.stringify({ chatMenuItems: menuItems }, null, 2));
  }
} finally {
  await context.close();
  await browser.close();
}
