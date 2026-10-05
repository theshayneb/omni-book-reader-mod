import { App, Menu, Modal, Notice, Plugin, TFile, normalizePath, setIcon, type Command } from "obsidian";
import { AnnotationDocumentService, PROTOCOL_ACTION, isBookLink, type AnnotationDocumentInput } from "./annotation-documents";
import { OMNI_BOOK_READER_BOOKSHELF_VIEW_TYPE, OmniBookReaderBookshelfView } from "./bookshelf-view";
import { ORIGINAL_PLUGIN_ID, loadLegacyPluginData } from "./legacy-plugin-data";
import { OMNI_BOOK_READER_VIEW_TYPE, OmniBookReaderView } from "./reader-view";
import { ReadingSyncService } from "./reading-sync";
import type { AppliedBookChange } from "./reading-sync-model";
import { OmniBookReaderSettingTab } from "./settings-ui";
import { ReaderDataStore } from "./store";
import type { ReaderSettings } from "./types";
import { isValidCfi, normalizeVaultPath } from "./utils";

function progressText(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

class RecentReadingModal extends Modal {
  constructor(app: App, private readonly store: ReaderDataStore) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("omni-book-reader-recent-modal");
    this.titleEl.setText("Recent reading");
    const books = Object.entries(this.store.snapshot.books)
      .filter(([, state]) => Boolean(state.readingStats?.lastOpenedAt))
      .sort(([, left], [, right]) => (right.readingStats?.lastOpenedAt ?? 0) - (left.readingStats?.lastOpenedAt ?? 0))
      .slice(0, 20);
    if (!books.length) {
      this.contentEl.createDiv({ cls: "omni-book-reader-empty", text: "No reading history yet" });
      return;
    }
    const list = this.contentEl.createDiv({ cls: "omni-book-reader-recent-list" });
    for (const [path, state] of books) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "epub") continue;
      const button = list.createEl("button", { cls: "omni-book-reader-recent-item", attr: { type: "button" } });
      const icon = button.createSpan({ cls: "omni-book-reader-recent-icon" });
      setIcon(icon, "book-open");
      const text = button.createSpan({ cls: "omni-book-reader-recent-text" });
      text.createSpan({ cls: "omni-book-reader-recent-title", text: file.basename });
      text.createSpan({
        cls: "omni-book-reader-recent-meta",
        text: `${progressText(state.position?.fraction ?? state.readingStats?.furthestFraction ?? 0)} · ${new Date(state.readingStats!.lastOpenedAt).toLocaleString("en-US")}`,
      });
      button.addEventListener("click", () => {
        void this.app.workspace.getLeaf(true).openFile(file);
        this.close();
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export default class OmniBookReaderPlugin extends Plugin {
  store!: ReaderDataStore;
  private annotationDocuments!: AnnotationDocumentService;
  private readingSync!: ReadingSyncService;
  private syncRestartTimer: number | null = null;

  async onload(): Promise<void> {
    this.store = new ReaderDataStore(this, (error) => {
      console.error("[Omni Book Reader] Failed to persist data", error);
    });
    await this.store.load();
    try {
      const pluginsDirectory = normalizePath(`${this.app.vault.configDir}/plugins`);
      const currentPluginDirectory = normalizePath(this.manifest.dir ?? `${pluginsDirectory}/${this.manifest.id}`);
      const legacyData = await loadLegacyPluginData(
        this.app.vault.adapter,
        pluginsDirectory,
        currentPluginDirectory,
        [this.manifest.id, ORIGINAL_PLUGIN_ID],
      );
      if (legacyData.length && this.store.mergeLegacyData(legacyData)) {
        await this.store.flush();
        new Notice("Recovered reading progress, highlights, and statistics from a previous plugin folder.");
      }
    } catch (error) {
      console.error("[Omni Book Reader] Could not recover data from a previous plugin folder", error);
    }
    this.annotationDocuments = new AnnotationDocumentService(
      this.app.vault,
      (file) => this.app.fileManager.trashFile(file),
      (sourceFile) => this.findBookNote(sourceFile),
    );
    try {
      await this.annotationDocuments.migrateLegacyProtocolLinks(
        Object.values(this.store.snapshot.books).map((state) => state.annotationDocuments),
      );
    } catch (error) {
      console.error("[Omni Book Reader] Could not migrate legacy CFI links", error);
    }

    this.registerView(OMNI_BOOK_READER_VIEW_TYPE, (leaf) => new OmniBookReaderView(leaf, this));
    this.registerView(OMNI_BOOK_READER_BOOKSHELF_VIEW_TYPE, (leaf) => new OmniBookReaderBookshelfView(leaf, this));
    try {
      this.registerExtensions(["epub"], OMNI_BOOK_READER_VIEW_TYPE);
    } catch (error) {
      console.error("[Omni Book Reader] Could not register .epub extension", error);
      new Notice("Omni Book Reader could not register .epub files. Disable other EPUB reader plugins and reload Obsidian.");
    }

    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => {
      void this.openProtocolLocation(params.path, params.cfi, params.sourceVault ?? params.vault);
    });
    this.registerDomEvent(document, "click", (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      const href = anchor?.getAttribute("href") ?? "";
      if (!isBookLink(href)) return;
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.openProtocolLocation(
        url.searchParams.get("path") ?? undefined,
        url.searchParams.get("cfi") ?? undefined,
        url.searchParams.get("sourceVault") ?? url.searchParams.get("vault") ?? undefined,
      );
    }, { capture: true });

    this.addUiCommand({
      id: "open-current-epub",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        const available = file instanceof TFile && file.extension.toLowerCase() === "epub";
        if (!checking && available) void this.openEpub(file);
        return available;
      },
    }, "Omni Book Reader: Open current EPUB");

    this.addUiCommand({
      id: "open-epub-bookshelf",
      callback: () => void this.openBookshelf(),
    }, "Omni Book Reader: Open bookshelf");
    this.addRibbonIcon("library", "Open Omni Book Reader bookshelf", () => void this.openBookshelf());

    this.addUiCommand({
      id: "open-recent-epub",
      callback: () => new RecentReadingModal(this.app, this.store).open(),
    }, "Omni Book Reader: Recent and continue reading");

    this.addUiCommand({
      id: "toggle-reader-sidebar",
      checkCallback: (checking) => {
        const view = this.getActiveReader();
        if (!checking) view?.toggleSidebar();
        return Boolean(view);
      },
    }, "Omni Book Reader: Toggle reader sidebar");

    this.addUiCommand({
      id: "toggle-current-bookmark",
      checkCallback: (checking) => {
        const view = this.getActiveReader();
        if (!checking) view?.toggleBookmark();
        return Boolean(view);
      },
    }, "Omni Book Reader: Add or remove bookmark here");

    this.addUiCommand({
      id: "export-current-highlights",
      checkCallback: (checking) => {
        const view = this.getActiveReader();
        if (!checking && view) void view.exportAnnotations();
        return Boolean(view);
      },
    }, "Omni Book Reader: Export highlights and notes from current EPUB");

    this.addUiCommand({
      id: "export-current-chapter",
      checkCallback: (checking) => {
        const view = this.getActiveReader();
        if (!checking && view) void view.exportCurrentChapter();
        return Boolean(view);
      },
    }, "Omni Book Reader: Export current EPUB chapter as Markdown");

    this.addUiCommand({
      id: "toggle-focus-paragraph",
      checkCallback: (checking) => {
        const view = this.getActiveReader();
        if (!checking) void view?.toggleFocusMode();
        return Boolean(view);
      },
    }, "Omni Book Reader: Toggle immersive reading");

    this.addUiCommand({
      id: "show-reading-stats",
      checkCallback: (checking) => {
        const view = this.getActiveReader();
        if (!checking) view?.openReadingStats();
        return Boolean(view);
      },
    }, "Omni Book Reader: Show reading statistics");

    this.addUiCommand({
      id: "show-reader-tutorial",
      checkCallback: (checking) => {
        const view = this.getActiveReader();
        if (!checking) view?.openTutorial();
        return Boolean(view);
      },
    }, "Omni Book Reader: Reopen reader tutorial");

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension.toLowerCase() === "epub") {
        this.store.renameBook(oldPath, file.path);
        this.readingSync.handleBookRename(oldPath, file.path);
      }
    }));

    this.readingSync = new ReadingSyncService(this);
    this.registerEvent(this.app.vault.on("create", (file) => this.readingSync.handleVaultChange(file)));
    this.registerEvent(this.app.vault.on("modify", (file) => this.readingSync.handleVaultChange(file)));
    // Mobile apps can be suspended or killed after backgrounding, so write pending progress right away.
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState !== "hidden") return;
      void this.store.flush();
      void this.readingSync.flush();
    });
    this.app.workspace.onLayoutReady(() => void this.readingSync.start());
    this.addUiCommand({
      id: "sync-reading-data",
      callback: () => void this.syncReadingDataNow(),
    }, "Omni Book Reader: Sync reading data now");

    this.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file) => {
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "epub") return;
      const state = this.store.getBook(file.path);
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(state?.hiddenFromBookshelf
          ? "Omni Book Reader: Add to bookshelf"
          : "Omni Book Reader: Remove from bookshelf")
        .setIcon(state?.hiddenFromBookshelf ? "library-big" : "eye-off")
        .onClick(() => {
          const book = this.store.ensureBook(file.path, { size: file.stat.size, mtime: file.stat.mtime });
          book.hiddenFromBookshelf = state?.hiddenFromBookshelf ? undefined : true;
          this.store.markChanged(0);
          this.refreshBookshelves();
          new Notice(book.hiddenFromBookshelf
            ? "Removed from the Omni Book Reader bookshelf"
            : "Added to the Omni Book Reader bookshelf");
        }));
    }));

    this.addSettingTab(new OmniBookReaderSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.syncRestartTimer !== null) window.clearTimeout(this.syncRestartTimer);
    void this.readingSync?.flush().finally(() => this.readingSync.stop());
    void this.store?.flush();
    void this.annotationDocuments?.flush();
  }

  getReaderSettings(): ReaderSettings {
    return this.store.settings;
  }

  getCoverCacheDirectory(): string {
    return normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/.cover-cache`);
  }

  updateReaderSettings(patch: Partial<ReaderSettings>): void {
    const syncChanged = (patch.syncEnabled !== undefined && patch.syncEnabled !== this.store.settings.syncEnabled)
      || (patch.syncFolder !== undefined && patch.syncFolder !== this.store.settings.syncFolder);
    this.store.updateSettings(patch);
    if (syncChanged) this.scheduleSyncRestart();
    const bookshelfChanged = patch.bookshelfDisplayMode !== undefined
      || patch.bookshelfFilter !== undefined || patch.bookshelfSort !== undefined;
    if (bookshelfChanged) {
      this.refreshBookshelves();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(OMNI_BOOK_READER_VIEW_TYPE)) {
      if (leaf.view instanceof OmniBookReaderView) {
        leaf.view.applySettings();
      }
    }
  }

  syncAnnotationDocuments(input: AnnotationDocumentInput): Promise<void> {
    return this.annotationDocuments.sync(input);
  }

  /** The Markdown note named like the EPUB, which holds the book's highlights. */
  private findBookNote(sourceFile: TFile): TFile | null {
    const linked = this.app.metadataCache.getFirstLinkpathDest(sourceFile.basename, sourceFile.path);
    if (linked && linked.extension.toLowerCase() === "md" && linked.basename === sourceFile.basename) return linked;
    return this.app.vault.getMarkdownFiles().find((file) => file.basename === sourceFile.basename) ?? null;
  }

  async openEpub(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: OMNI_BOOK_READER_VIEW_TYPE,
      state: { file: file.path },
      active: true,
    });
  }

  private async openBookshelf(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(OMNI_BOOK_READER_BOOKSHELF_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeftLeaf(false) ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: OMNI_BOOK_READER_BOOKSHELF_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  onSyncedBookChanges(changes: AppliedBookChange[]): void {
    const byPath = new Map(changes.map((change) => [change.path, change]));
    for (const leaf of this.app.workspace.getLeavesOfType(OMNI_BOOK_READER_VIEW_TYPE)) {
      const view = leaf.view;
      if (!(view instanceof OmniBookReaderView) || !view.file) continue;
      const change = byPath.get(view.file.path);
      if (change) view.applySyncedChanges(change);
    }
    this.refreshBookshelves();
  }

  private scheduleSyncRestart(): void {
    // The folder is edited in a text field, so wait until typing pauses before restarting.
    if (this.syncRestartTimer !== null) window.clearTimeout(this.syncRestartTimer);
    this.syncRestartTimer = window.setTimeout(() => {
      this.syncRestartTimer = null;
      void this.readingSync.flush().then(() => this.readingSync.start());
    }, 1000);
  }

  private async syncReadingDataNow(): Promise<void> {
    if (!this.store.settings.syncEnabled) {
      new Notice("Reading sync is turned off in Omni Book Reader settings.");
      return;
    }
    await this.readingSync.flush();
    await this.readingSync.start();
    new Notice("Reading data synced with other devices.");
  }

  private refreshBookshelves(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(OMNI_BOOK_READER_BOOKSHELF_VIEW_TYPE)) {
      if (leaf.view instanceof OmniBookReaderBookshelfView) leaf.view.refresh();
    }
  }

  private async openProtocolLocation(pathValue: string | undefined, cfiValue: string | undefined, vaultValue: string | undefined): Promise<void> {
    if (vaultValue && vaultValue !== this.app.vault.getName()) {
      new Notice(`This CFI link belongs to another Vault: ${vaultValue}`);
      return;
    }
    const path = normalizeVaultPath(pathValue ?? "");
    const cfi = String(cfiValue ?? "").trim();
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "epub") {
      new Notice("The EPUB in this CFI link does not exist");
      return;
    }
    if (!isValidCfi(cfi)) {
      new Notice("The reading position in this CFI link is invalid");
      return;
    }
    try {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.openFile(file);
      if (leaf.view instanceof OmniBookReaderView) await leaf.view.navigateToCfi(cfi);
      else new Notice("Could not create the EPUB reader view");
    } catch (error) {
      console.error("[Omni Book Reader] Failed to open CFI link", error);
      new Notice("Could not open the EPUB source location");
    }
  }

  private getActiveReader(): OmniBookReaderView | null {
    const view = this.app.workspace.getActiveViewOfType(OmniBookReaderView);
    return view ?? null;
  }

  private addUiCommand(command: Omit<Command, "name">, name: string): void {
    this.addCommand({ ...command, name });
  }
}
