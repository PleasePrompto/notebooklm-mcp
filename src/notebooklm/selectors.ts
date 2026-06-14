/**
 * Central selector registry for the NotebookLM web UI.
 *
 * # Multilingual strategy
 *
 * Google ships NotebookLM in dozens of locales. Anchor priority:
 *
 *   1. **Class names** (`.add-source-button`, `.single-source-container`,
 *      `.submit-button`, `.create-artifact-button-container`, …) — these
 *      are Angular component selectors and identical in every locale.
 *
 *   2. **Material-Symbols icon names** (`audio_magic_eraser`, `content_paste`,
 *      `link`, `upload`, `download`, …) — Google ships them as the literal
 *      text node of `<mat-icon>` in every locale, so they are 100% language-
 *      agnostic. Most stable anchor for icon-driven controls.
 *
 *   3. **`role="dialog"`, `role="button"`** — set synchronously by Angular,
 *      no animation race.
 *
 *   4. **Locale-bound aria-labels and visible text** — last resort. Each
 *      list below covers the eight major NotebookLM locales:
 *      EN, DE, FR, ES, PT, IT, NL, JA. Adding more is mechanical; nothing
 *      breaks if a locale is missing because the class/icon anchors fire
 *      first.
 *
 * Last verified: 2026-05 against the live notebooklm.google.com layout
 * (DE, EN locales).
 */

export const Selectors = {
  chat: {
    answerContainer: ".to-user-container",
    answerText: ".to-user-container .message-text-content",
    latestAnswerText: ".to-user-container:last-child .message-text-content",
    /**
     * Chat textarea. The class is shared across locales; aria-labels are a
     * fallback for older builds where the class was different.
     */
    queryInput: [
      "textarea.query-box-input",
      'textarea[aria-label*="query" i]',
      'textarea[aria-label*="anfrag" i]',
      'textarea[aria-label*="requete" i]',
      'textarea[aria-label*="zone de requete" i]',
      'textarea[aria-label*="consulta" i]',
      'textarea[aria-label*="domanda" i]',
      'textarea[aria-label*="vraag" i]',
      'textarea[aria-label*="質問" i]',
      'textarea[aria-label*="pergunta" i]',
    ],
    /**
     * The chat submit button has the *language-bound* aria-label
     * (Send / Senden / Envoyer / Enviar / Invia / Verzenden / 送信). It also
     * has the stable class `.submit-button`. The sources web-search overlay
     * uses `.actions-enter-button` with the SAME aria-label, so we MUST
     * anchor on `.submit-button` to avoid distractor matches.
     */
    submitButton: [
      "button.submit-button",
      'button.submit-button[aria-label*="send" i]',
      'button.submit-button[aria-label*="senden" i]',
      'button.submit-button[aria-label*="envoyer" i]',
      'button.submit-button[aria-label*="enviar" i]',
      'button.submit-button[aria-label*="invia" i]',
      'button.submit-button[aria-label*="verzend" i]',
      'button.submit-button[aria-label*="送信" i]',
    ],
  },

  /**
   * NotebookLM removed tabs in favour of a three-pane sidebar (2026 layout).
   * These selectors are kept only for the rare legacy layouts.
   */
  tabs: {
    discussion: [
      '[role="tab"]:has-text("Discussion")',
      '[role="tab"]:has-text("Diskussion")',
      '[role="tab"]:has-text("Diskussionen")',
      '[role="tab"]:has-text("Discusión")',
      '[role="tab"]:has-text("Discussione")',
      '[role="tab"]:has-text("Discussão")',
      '[role="tab"]:has-text("ディスカッション")',
    ],
    sources: [
      '[role="tab"]:has-text("Sources")',
      '[role="tab"]:has-text("Quellen")',
      '[role="tab"]:has-text("Fuentes")',
      '[role="tab"]:has-text("Fonti")',
      '[role="tab"]:has-text("Fontes")',
      '[role="tab"]:has-text("Bronnen")',
      '[role="tab"]:has-text("ソース")',
    ],
    activeTabClass: "mdc-tab--active",
    tabList: ".mat-mdc-tab-list .mdc-tab",
  },

  citations: {
    button: [
      "button.citation-marker",
      "button.xap-inline-dialog.citation-marker",
      "button[data-citation]",
    ],
    label: "span[aria-label]",
    highlight: ".highlighted",
    paragraph: ".paragraph",
    paragraphHighlight: ".paragraph .highlighted",
  },

  sources: {
    /**
     * Per-source row in the sidebar (language-agnostic). Stable Angular
     * class — verified across all observed locales.
     */
    sourceContainer: ".single-source-container",
    /**
     * "X Quellen" / "X sources" header text. Numeric so we read the count
     * via regex on the visible text. Independent of sidebar collapse state.
     */
    sourceCountIndicator: ".cover-subtitle-source-count",
    /**
     * Sidebar "Add source" button. Class `.add-source-button` is language-
     * agnostic; aria-labels listed for older builds without the class.
     */
    addButton: [
      "button.add-source-button",
      'button[aria-label="Add source"]',
      'button[aria-label="Add sources"]',
      'button[aria-label*="add source" i]',
      'button[aria-label*="add sources" i]',
      'button:has-text("Add source")',
      'button:has-text("Add sources")',
      'button[aria-label*="quelle hinzu" i]',
      'button[aria-label*="ajouter une source" i]',
      'button[aria-label*="añadir fuente" i]',
      'button[aria-label*="agregar fuente" i]',
      'button[aria-label*="aggiungi fonte" i]',
      'button[aria-label*="adicionar fonte" i]',
      'button[aria-label*="bron toevoegen" i]',
      'button[aria-label*="ソースを追加" i]',
    ],
    /**
     * Real Material modal. `[role="dialog"]` alone is too narrow and too
     * broad at the same time:
     *  • Too narrow — NotebookLM 2026 sometimes renders the modal as
     *    `mat-dialog-container` or a `[aria-modal="true"]` element with no
     *    explicit role.
     *  • Too broad — the page always carries a hidden Emoji-palette dialog
     *    (`[role="dialog" aria-label="Emoji characters palette"]`); a bare
     *    selector matches it first, and `.first().waitFor({state:visible})`
     *    then blocks forever waiting on a hidden element. Locally observed
     *    with `24 × locator resolved to hidden <div role="dialog"
     *    aria-label="Emoji characters palette">` before a 10 s timeout.
     * Fix: union of three modal-flavored anchors, scoped to :visible and
     * excluding the Emoji palette by aria-label. Resistant to Material-UI
     * version bumps without re-introducing the dropdown/menu false
     * positives that `.cdk-overlay-pane` would cause. See issue #46.
     */
    overlayPane:
      '[role="dialog"]:not([aria-label*="Emoji" i]):visible, mat-dialog-container:visible, [aria-modal="true"]:visible',
    overlayInput:
      '[role="dialog"]:not([aria-label*="Emoji" i]):visible input[type="text"]:not([readonly]), ' +
      'mat-dialog-container:visible input[type="text"]:not([readonly]), ' +
      '[aria-modal="true"]:visible input[type="text"]:not([readonly])',
    overlayTextarea:
      '[role="dialog"]:not([aria-label*="Emoji" i]):visible textarea, ' +
      "mat-dialog-container:visible textarea, " +
      '[aria-modal="true"]:visible textarea',
    /**
     * Current NotebookLM builds can expose the Add sources picker as a source
     * menu before, or instead of, a strict dialog role. Treat these controls as
     * a ready add-source UI so source ingestion does not fail before typing.
     */
    sourcePickerReady: [
      'button.drop-zone-icon-button:has(mat-icon:text-is("upload"))',
      'button.drop-zone-icon-button:has-text("Upload files")',
      'button.drop-zone-icon-button:has-text("Upload sources")',
      'input[type="file"]',
    ],
    /**
     * Source-type buttons in the Add-source overlay. Google ships them
     * *without* aria-labels — the only stable, language-agnostic anchor is
     * the Material-Symbols icon name baked into a `<mat-icon>` text node.
     */
    sourceTypeUrl: [
      // Icon-anchored (language-free) — primary path.
      "button.drop-zone-icon-button:has(mat-icon.youtube-icon)",
      'button.drop-zone-icon-button:has(mat-icon:text-is("link"))',
      // Visible-text fallbacks for the eight major locales.
      'button.drop-zone-icon-button:has-text("Websites")',
      'button.drop-zone-icon-button:has-text("Website")',
      'button.drop-zone-icon-button:has-text("Sites Web")',
      'button.drop-zone-icon-button:has-text("Sitio web")',
      'button.drop-zone-icon-button:has-text("Sito web")',
      'button.drop-zone-icon-button:has-text("Sites")',
      'button.drop-zone-icon-button:has-text("ウェブサイト")',
      'span:has-text("Website")',
      'span:has-text("URL")',
    ],
    sourceTypeText: [
      // Icon-anchored (language-free) — primary path.
      'button.drop-zone-icon-button:has(mat-icon:text-is("content_paste"))',
      // Visible-text fallbacks for major locales.
      'button.drop-zone-icon-button:has-text("Kopierter Text")',
      'button.drop-zone-icon-button:has-text("Copied text")',
      'button.drop-zone-icon-button:has-text("Pasted text")',
      'button.drop-zone-icon-button:has-text("Texte copié")',
      'button.drop-zone-icon-button:has-text("Texto copiado")',
      'button.drop-zone-icon-button:has-text("Testo copiato")',
      'button.drop-zone-icon-button:has-text("Gekopieerde tekst")',
      'button.drop-zone-icon-button:has-text("コピーしたテキスト")',
      'span:has-text("Copied text")',
      'span:has-text("Pasted text")',
      '[data-type="text"]',
    ],
    sourceTypeYoutube: [
      "button.drop-zone-icon-button mat-icon.youtube-icon",
      'button.drop-zone-icon-button:has(mat-icon:text-is("video_youtube"))',
    ],
    sourceTypeFile: [
      'input[type="file"]',
      'button.drop-zone-icon-button:has(mat-icon:text-is("upload"))',
      'button.drop-zone-icon-button:has-text("Dateien hochladen")',
      'button.drop-zone-icon-button:has-text("Upload sources")',
      'button.drop-zone-icon-button:has-text("Importer")',
      'button.drop-zone-icon-button:has-text("Subir")',
      'button.drop-zone-icon-button:has-text("Carica")',
      'button.drop-zone-icon-button:has-text("Uploaden")',
      'button.drop-zone-icon-button:has-text("アップロード")',
    ],
    /**
     * Primary submit button in the add-source dialog. Material's
     * `.mdc-button--raised` class is the most stable anchor; per-locale
     * visible-text variants are fallbacks for older builds.
     */
    insertConfirm: [
      // Class-anchored (language-free).
      'button.mdc-button--raised:has-text("Insert")',
      'button.mat-flat-button:has-text("Insert")',
      'button[color="primary"]:has-text("Insert")',
      // Visible-text fallbacks for major locales.
      'button.mdc-button--raised:has-text("Einfügen")',
      'button.mdc-button--raised:has-text("Hinzufügen")',
      'button.mdc-button--raised:has-text("Ajouter")',
      'button.mdc-button--raised:has-text("Insertar")',
      'button.mdc-button--raised:has-text("Inserisci")',
      'button.mdc-button--raised:has-text("Invoegen")',
      'button.mdc-button--raised:has-text("挿入")',
      'button:has-text("Insert")',
      'button:has-text("Einfügen")',
      'button:has-text("Hinzufügen")',
      'button:has-text("Ajouter")',
      'button:has-text("Insérer")',
      'button:has-text("Insertar")',
      'button:has-text("Añadir")',
      'button:has-text("Agregar")',
      'button:has-text("Inserisci")',
      'button:has-text("Aggiungi")',
      'button:has-text("Inserir")',
      'button:has-text("Adicionar")',
      'button:has-text("Invoegen")',
      'button:has-text("Toevoegen")',
      'button:has-text("挿入")',
      'button:has-text("追加")',
      'button:has-text("Add")',
      'button:has-text("Submit")',
      'button[type="submit"]',
      '[role="dialog"] .mdc-dialog__actions button:not(:has-text("Cancel")):not(:has-text("Close")):not(:has-text("Schließen")):not(:has-text("Annuler")):not(:has-text("Cancelar")):not(:has-text("Annulla")):not(:has-text("Annuleren")):not(:has-text("キャンセル"))',
    ],
  },

  studio: {
    /**
     * "Audio Overview" entry control. As of the 2026-05 Studio layout this
     * is a `<div role="button">` with a Material-Symbols `audio_magic_eraser`
     * icon, NOT a real `<button>`. Icon-anchored selectors fire first.
     */
    audioOverviewButton: [
      // Icon-anchored (language-free) — primary path.
      '.create-artifact-button-container:has(mat-icon:text-is("audio_magic_eraser"))',
      '[role="button"]:has(mat-icon:text-is("audio_magic_eraser"))',
      // Locale-bound aria-labels for the eight major locales.
      '[role="button"][aria-label*="audio-zusammenfassung" i]',
      '[role="button"][aria-label*="audio overview" i]',
      '[role="button"][aria-label*="aperçu audio" i]',
      '[role="button"][aria-label*="resumen de audio" i]',
      '[role="button"][aria-label*="panoramica audio" i]',
      '[role="button"][aria-label*="visão geral de áudio" i]',
      '[role="button"][aria-label*="audio-overzicht" i]',
      '[role="button"][aria-label*="音声の概要" i]',
      '[role="button"][aria-label*="audio" i]',
      // Legacy <button> fallbacks for older builds.
      'button:has(mat-icon:text-is("audio_magic_eraser"))',
      'button[aria-label*="audio overview" i]',
      'button[aria-label*="audio-zusammenfassung" i]',
      'button[aria-label*="podcast" i]',
    ],
    /**
     * Generate / Generieren / Générer trigger inside the customise dialog.
     * Visible-text varies by locale.
     */
    generateButton: [
      'button:has-text("Generate")',
      'button:has-text("Generieren")',
      'button:has-text("Générer")',
      'button:has-text("Generer")',
      'button:has-text("Generar")',
      'button:has-text("Genera")',
      'button:has-text("Gerar")',
      'button:has-text("Genereren")',
      'button:has-text("生成")',
    ],
    /**
     * Download trigger. The Studio panel uses an icon-only button with a
     * `download` Material-Symbols glyph; aria-label is locale-bound.
     */
    downloadButton: [
      // Icon-anchored (language-free) — primary path.
      'button:has(mat-icon:text-is("download"))',
      // Locale-bound aria-labels.
      'button[aria-label*="download" i]',
      'button[aria-label*="herunterladen" i]',
      'button[aria-label*="télécharger" i]',
      'button[aria-label*="descargar" i]',
      'button[aria-label*="scarica" i]',
      'button[aria-label*="baixar" i]',
      'button[aria-label*="downloaden" i]',
      'button[aria-label*="ダウンロード" i]',
    ],
    /**
     * Completed Audio-Overview tile. Modern NotebookLM does NOT mount a real
     * `<audio>` element in the DOM; the player is a custom Angular tile
     * inside `.artifact-library-container > artifact-library-item`. The
     * play-button (`button.artifact-action-button` with locale-bound
     * aria-label "Wiedergeben"/"Play"/…) is the most reliable "audio is
     * ready" signal because it only mounts after generation completes.
     */
    audioPlayer: [
      "artifact-library-item:has(button.artifact-action-button)",
      ".artifact-library-container artifact-library-item",
      // Legacy <audio> tag for older builds.
      "audio",
      '[role="audio"]',
    ],
    /**
     * Per-tile "Mehr"/"More"/"Plus"/… three-dot button. Opens the menu that
     * contains the Download item.
     */
    audioMoreMenuButton: [
      'artifact-library-item button:has(mat-icon:text-is("more_vert"))',
      'artifact-library-item button[aria-label*="mehr" i]',
      'artifact-library-item button[aria-label*="more" i]',
      'artifact-library-item button[aria-label*="plus" i]',
      'artifact-library-item button[aria-label*="más" i]',
      'artifact-library-item button[aria-label*="altro" i]',
      'artifact-library-item button[aria-label*="mais" i]',
      'artifact-library-item button[aria-label*="meer" i]',
      'artifact-library-item button[aria-label*="その他" i]',
    ],
    /**
     * Download menu-item that surfaces after clicking the three-dot menu.
     */
    audioDownloadMenuItem: [
      '[role="menuitem"]:has(mat-icon:text-is("download"))',
      '[role="menuitem"]:has-text("Download")',
      '[role="menuitem"]:has-text("Herunterladen")',
      '[role="menuitem"]:has-text("Télécharger")',
      '[role="menuitem"]:has-text("Descargar")',
      '[role="menuitem"]:has-text("Scarica")',
      '[role="menuitem"]:has-text("Baixar")',
      '[role="menuitem"]:has-text("Downloaden")',
      '[role="menuitem"]:has-text("ダウンロード")',
    ],
  },

  notebooks: {
    projectCard: 'button[aria-labelledby*="project-"]',
    cardMenuButton: [
      'button[aria-label*="menu" i]',
      'button[aria-label*="options" i]',
      'button[aria-label*="more" i]',
      'button[aria-label*="optionen" i]',
      'button[aria-label*="opzioni" i]',
      'button[aria-label*="opciones" i]',
      'button[aria-label*="opções" i]',
      'button[aria-label*="メニュー" i]',
    ],
    deleteButton: [
      '[role="menuitem"]:has-text("Delete")',
      '[role="menuitem"]:has-text("Löschen")',
      '[role="menuitem"]:has-text("Supprimer")',
      '[role="menuitem"]:has-text("Eliminar")',
      '[role="menuitem"]:has-text("Borrar")',
      '[role="menuitem"]:has-text("Elimina")',
      '[role="menuitem"]:has-text("Excluir")',
      '[role="menuitem"]:has-text("Verwijderen")',
      '[role="menuitem"]:has-text("削除")',
    ],
    confirmDelete: [
      'button:has-text("Delete")',
      'button:has-text("Löschen")',
      'button:has-text("Supprimer")',
      'button:has-text("Eliminar")',
      'button:has-text("Borrar")',
      'button:has-text("Elimina")',
      'button:has-text("Excluir")',
      'button:has-text("Verwijderen")',
      'button:has-text("削除")',
    ],
  },

  /**
   * Material Icon labels that leak into extracted answer text as isolated
   * lines. Stripped from the response before delivery to the client.
   */
  uiControlLabels: new Set([
    "more_horiz",
    "more_vert",
    "open_in_new",
    "content_copy",
    "bookmark_border",
    "expand_more",
    "expand_less",
    "thumb_up",
    "thumb_down",
    "share",
    "keep",
    "keep_pin",
    "copy_all",
    "arrow_forward",
  ]),
} as const;

/**
 * Joins a list of selector candidates into a comma-separated string.
 * Patchright/Playwright accepts this as a CSS locator (comma = OR).
 *
 * Example: `joinAlt(Selectors.chat.queryInput)` → `"textarea.query-box-input, textarea[aria-label*=\"query\" i], ..."`
 */
export function joinAlt(selectors: readonly string[]): string {
  return selectors.join(", ");
}
