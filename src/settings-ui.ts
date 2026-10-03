import { App, Modal, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import { DEFAULT_SETTINGS } from "./defaults";
import type { ReaderSettings } from "./types";

const SYNC_DESCRIPTION = "Keep reading progress, highlights, notes, bookmarks, and reading time in sync between your devices. "
  + "Each device writes its own file in the sync folder. With Obsidian Sync, turn on \"Sync all other types\" so these .json files are included.";
const SYNC_FOLDER_DESCRIPTION = "Vault folder for the per-device sync files. Use the same folder on every device.";

export interface SettingsHost {
  app: App;
  getReaderSettings(): ReaderSettings;
  updateReaderSettings(patch: Partial<ReaderSettings>): void;
}

function renderSettings(
  container: HTMLElement,
  host: SettingsHost,
  fixedLayout: boolean,
): void {
  const get = (): ReaderSettings => host.getReaderSettings();

  new Setting(container)
    .setName("Reading theme")
    .setDesc("Follow Obsidian or choose a separate theme for ebooks.")
    .addDropdown((dropdown) => dropdown
      .addOptions({
        auto: "Follow Obsidian",
        light: "Light",
        dark: "Dark",
        sepia: "Sepia",
      })
      .setValue(get().theme)
      .onChange((theme) => host.updateReaderSettings({ theme: theme as ReaderSettings["theme"] })));

  new Setting(container)
    .setName("Reading layout")
    .setDesc(fixedLayout
      ? "Fixed-layout EPUBs use the layout defined by the book."
      : "Switch between paginated and continuous scrolling.")
    .addDropdown((dropdown) => {
      dropdown
        .addOptions({ paginated: "Paginated", scrolled: "Continuous scroll" })
        .setValue(get().layout)
        .setDisabled(fixedLayout)
        .onChange((layout) => host.updateReaderSettings({ layout: layout as ReaderSettings["layout"] }));
    });

  new Setting(container)
    .setName("Tap to turn pages")
    .setDesc("In paginated reading, click or tap the left half for the previous page and the right half for the next page on desktop and mobile.")
    .addToggle((toggle) => toggle
      .setValue(get().tapToTurnPages)
      .onChange((tapToTurnPages) => host.updateReaderSettings({ tapToTurnPages })));

  new Setting(container)
    .setName("Auto-hide reader chrome")
    .setDesc("Fade reader controls after navigation and reveal them on pointer, touch, or keyboard activity.")
    .addToggle((toggle) => toggle
      .setValue(get().readerChromeAutoHide)
      .onChange((readerChromeAutoHide) => host.updateReaderSettings({ readerChromeAutoHide })));

  new Setting(container)
    .setName("Interface density")
    .setDesc("Compact mode reduces decorative spacing without shrinking touch targets.")
    .addDropdown((dropdown) => dropdown
      .addOptions({ comfortable: "Comfortable", compact: "Compact" })
      .setValue(get().interfaceDensity)
      .onChange((interfaceDensity) => host.updateReaderSettings({ interfaceDensity: interfaceDensity as ReaderSettings["interfaceDensity"] })));

  new Setting(container)
    .setName("Font")
    .setDesc("Follow Obsidian for consistent typography, or keep the publisher's fonts.")
    .addDropdown((dropdown) => dropdown
      .addOptions({
        obsidian: "Follow Obsidian",
        publisher: "Publisher fonts",
        serif: "Serif",
        sans: "Sans serif",
      })
      .setValue(get().font)
      .setDisabled(fixedLayout)
      .onChange((font) => host.updateReaderSettings({ font: font as ReaderSettings["font"] })));

  new Setting(container)
    .setName("Font size")
    .setDesc(`${get().fontSizePercent}%`)
    .addSlider((slider) => slider
      .setLimits(80, 180, 5)
      .setValue(get().fontSizePercent)
      .setDisabled(fixedLayout)
      .onChange((fontSizePercent) => host.updateReaderSettings({ fontSizePercent })));

  new Setting(container)
    .setName("Line height")
    .setDesc(get().lineHeight.toFixed(2))
    .addSlider((slider) => slider
      .setLimits(1.2, 2.2, 0.1)
      .setValue(get().lineHeight)
      .setDisabled(fixedLayout)
      .onChange((lineHeight) => host.updateReaderSettings({ lineHeight })));

  new Setting(container)
    .setName("Letter spacing")
    .setDesc(`${get().letterSpacing.toFixed(2)}em`)
    .addSlider((slider) => slider
      .setLimits(-0.02, 0.12, 0.01)
      .setValue(get().letterSpacing)
      .setDisabled(fixedLayout)
      .onChange((letterSpacing) => host.updateReaderSettings({ letterSpacing })));

  new Setting(container)
    .setName("Paragraph spacing")
    .setDesc(`${get().paragraphSpacing.toFixed(2)}em`)
    .addSlider((slider) => slider
      .setLimits(0, 1.2, 0.05)
      .setValue(get().paragraphSpacing)
      .setDisabled(fixedLayout)
      .onChange((paragraphSpacing) => host.updateReaderSettings({ paragraphSpacing })));

  new Setting(container)
    .setName("Page width")
    .setDesc("Standard suits long-form reading; wide and full add space; edge removes page margins.")
    .addDropdown((dropdown) => dropdown
      .addOptions({
        standard: "Standard",
        wide: "Wide",
        full: "Full width",
        edge: "Edge to edge",
      })
      .setValue(get().widthMode)
      .setDisabled(fixedLayout)
      .onChange((widthMode) => host.updateReaderSettings({ widthMode: widthMode as ReaderSettings["widthMode"] })));

  new Setting(container)
    .setName("Page margin")
    .setDesc(`${get().pageMargin}px`)
    .addSlider((slider) => slider
      .setLimits(0, 80, 4)
      .setValue(get().pageMargin)
      .setDisabled(fixedLayout)
      .onChange((pageMargin) => host.updateReaderSettings({ pageMargin })));

  new Setting(container)
    .setName("Comfortable typography")
    .setDesc("Restore comfortable defaults for font, rhythm, content width, and page margins.")
    .addButton((button) => button
      .setButtonText("Restore comfortable defaults")
      .setDisabled(fixedLayout)
      .onClick(() => host.updateReaderSettings({
        font: "obsidian",
        fontSizePercent: 100,
        lineHeight: 1.7,
        letterSpacing: 0.01,
        paragraphSpacing: 0.65,
        widthMode: "standard",
        contentWidth: 720,
        pageMargin: 48,
      })));

  new Setting(container).setName("Annotation export").setHeading();

  new Setting(container)
    .setName("Default highlight color")
    .setDesc("Use this color first when creating an annotation.")
    .addDropdown((dropdown) => dropdown
      .addOptions({ yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" })
      .setValue(get().defaultHighlightColor)
      .onChange((defaultHighlightColor) => host.updateReaderSettings({ defaultHighlightColor: defaultHighlightColor as ReaderSettings["defaultHighlightColor"] })));

  new Setting(container)
    .setName("Default annotation style")
    .addDropdown((dropdown) => dropdown
      .addOptions({ highlight: "Highlight", underline: "Underline", strikethrough: "Strikethrough", squiggly: "Squiggly" })
      .setValue(get().defaultHighlightStyle)
      .onChange((defaultHighlightStyle) => host.updateReaderSettings({ defaultHighlightStyle: defaultHighlightStyle as ReaderSettings["defaultHighlightStyle"] })));

  new Setting(container)
    .setName("Merge adjacent highlights")
    .setDesc("Save adjacent selections with matching chapter, color, and style as one annotation.")
    .addToggle((toggle) => toggle
      .setValue(get().connectAdjacentHighlights)
      .onChange((connectAdjacentHighlights) => host.updateReaderSettings({ connectAdjacentHighlights })));

  new Setting(container)
    .setName("Export template")
    .setDesc("Control how each annotation appears in each book's highlights and notes file.")
    .addDropdown((dropdown) => dropdown
      .addOptions({
        classic: "Classic sections",
        compact: "Compact list",
        callout: "Obsidian Callout",
        custom: "Custom template",
      })
      .setValue(get().exportTemplate)
      .onChange((exportTemplate) => host.updateReaderSettings({
        exportTemplate: exportTemplate as ReaderSettings["exportTemplate"],
      })));

  new Setting(container)
    .setName("Custom export template")
    .setDesc("Used when Custom template is selected. Enter a Markdown path in the vault. Supports {{document.title}}, {{document.kind}}, {{book.title}}, {{book.author}}, {{book.filePath}}, {{book.link}}, {{export.date}}, and {{entries}}.")
    .addText((text) => text
      .setPlaceholder("Templates/EPUB annotation export.md")
      .setValue(get().customExportTemplatePath)
      .onChange((customExportTemplatePath) => host.updateReaderSettings({ customExportTemplatePath })));
}

export class ReaderSettingsModal extends Modal {
  constructor(
    app: App,
    private readonly host: SettingsHost,
    private readonly fixedLayout: boolean,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("omni-book-reader-settings-modal");
    this.titleEl.setText("EPUB reading settings");
    this.contentEl.addClass("omni-book-reader-settings");
    renderSettings(this.contentEl, this.host, this.fixedLayout);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class OmniBookReaderSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: SettingsHost & Plugin) {
    super(app, host);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Reading settings",
        cls: "omni-book-reader-settings-page",
        items: [
          {
            name: "Reading theme",
            desc: "Follow Obsidian or choose a separate theme for ebooks.",
            control: {
              type: "dropdown",
              key: "theme",
              options: {
                auto: "Follow Obsidian",
                light: "Light",
                dark: "Dark",
                sepia: "Sepia",
              },
            },
          },
          {
            name: "Reading layout",
            desc: "Switch between paginated and continuous scrolling.",
            control: {
              type: "dropdown",
              key: "layout",
              options: {
                paginated: "Paginated",
                scrolled: "Continuous scroll",
              },
            },
          },
          {
            name: "Tap to turn pages",
            desc: "In paginated reading, click or tap the left half for the previous page and the right half for the next page on desktop and mobile.",
            control: {
              type: "toggle",
              key: "tapToTurnPages",
            },
          },
          {
            name: "Auto-hide reader chrome",
            desc: "Fade reader controls after navigation and reveal them during interaction.",
            control: { type: "toggle", key: "readerChromeAutoHide" },
          },
          {
            name: "Interface density",
            desc: "Compact mode keeps full-size touch targets.",
            control: {
              type: "dropdown", key: "interfaceDensity",
              options: { comfortable: "Comfortable", compact: "Compact" },
            },
          },
          {
            name: "Font",
            desc: "Follow Obsidian for consistent typography, or keep the publisher's fonts.",
            control: {
              type: "dropdown",
              key: "font",
              options: {
                obsidian: "Follow Obsidian",
                publisher: "Publisher fonts",
                serif: "Serif",
                sans: "Sans serif",
              },
            },
          },
          {
            name: "Font size",
            control: {
              type: "slider",
              key: "fontSizePercent",
              min: 80,
              max: 180,
              step: 5,
              displayFormat: (value) => `${value}%`,
            },
          },
          {
            name: "Line height",
            control: {
              type: "slider",
              key: "lineHeight",
              min: 1.2,
              max: 2.2,
              step: 0.1,
              displayFormat: (value) => value.toFixed(2),
            },
          },
          {
            name: "Letter spacing",
            control: {
              type: "slider",
              key: "letterSpacing",
              min: -0.02,
              max: 0.12,
              step: 0.01,
              displayFormat: (value) => `${value.toFixed(2)}em`,
            },
          },
          {
            name: "Paragraph spacing",
            control: {
              type: "slider",
              key: "paragraphSpacing",
              min: 0,
              max: 1.2,
              step: 0.05,
              displayFormat: (value) => `${value.toFixed(2)}em`,
            },
          },
          {
            name: "Page width",
            desc: "Standard suits long-form reading; wide and full add space; edge removes page margins.",
            control: {
              type: "dropdown",
              key: "widthMode",
              options: {
                standard: "Standard",
                wide: "Wide",
                full: "Full width",
                edge: "Edge to edge",
              },
            },
          },
          {
            name: "Page margin",
            control: {
              type: "slider",
              key: "pageMargin",
              min: 0,
              max: 80,
              step: 4,
              displayFormat: (value) => `${value}px`,
            },
          },
          {
            name: "Comfortable typography",
            desc: "Restore comfortable defaults for font, rhythm, content width, and page margins.",
            action: () => {
              this.host.updateReaderSettings({
                font: "obsidian",
                fontSizePercent: 100,
                lineHeight: 1.7,
                letterSpacing: 0.01,
                paragraphSpacing: 0.65,
                widthMode: "standard",
                contentWidth: 720,
                pageMargin: 48,
              });
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Annotation export",
        cls: "omni-book-reader-settings-page",
        items: [
          {
            name: "Default highlight color",
            control: {
              type: "dropdown", key: "defaultHighlightColor",
              options: { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink" },
            },
          },
          {
            name: "Default annotation style",
            control: {
              type: "dropdown", key: "defaultHighlightStyle",
              options: { highlight: "Highlight", underline: "Underline", strikethrough: "Strikethrough", squiggly: "Squiggly" },
            },
          },
          {
            name: "Merge adjacent highlights",
            control: { type: "toggle", key: "connectAdjacentHighlights" },
          },
          {
            name: "Export template",
            desc: "Control how each annotation appears in each book's highlights and notes file.",
            control: {
              type: "dropdown",
              key: "exportTemplate",
              options: {
                classic: "Classic sections",
                compact: "Compact list",
                callout: "Obsidian Callout",
                custom: "Custom template",
              },
            },
          },
          {
            name: "Custom export template",
            desc: "Used when Custom template is selected. Enter a Markdown path in the vault. Supports {{document.title}}, {{document.kind}}, {{book.title}}, {{book.author}}, {{book.filePath}}, {{book.link}}, {{export.date}}, and {{entries}}.",
            control: {
              type: "text",
              key: "customExportTemplatePath",
              placeholder: "Templates/EPUB annotation export.md",
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Sync across devices",
        cls: "omni-book-reader-settings-page",
        items: [
          {
            name: "Sync reading data",
            desc: SYNC_DESCRIPTION,
            control: { type: "toggle", key: "syncEnabled" },
          },
          {
            name: "Sync folder",
            desc: SYNC_FOLDER_DESCRIPTION,
            control: { type: "text", key: "syncFolder", placeholder: DEFAULT_SETTINGS.syncFolder },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    const settings = this.host.getReaderSettings();
    switch (key) {
      case "theme": return settings.theme;
      case "layout": return settings.layout;
      case "tapToTurnPages": return settings.tapToTurnPages;
      case "readerChromeAutoHide": return settings.readerChromeAutoHide;
      case "interfaceDensity": return settings.interfaceDensity;
      case "defaultHighlightColor": return settings.defaultHighlightColor;
      case "defaultHighlightStyle": return settings.defaultHighlightStyle;
      case "connectAdjacentHighlights": return settings.connectAdjacentHighlights;
      case "font": return settings.font;
      case "fontSizePercent": return settings.fontSizePercent;
      case "lineHeight": return settings.lineHeight;
      case "letterSpacing": return settings.letterSpacing;
      case "paragraphSpacing": return settings.paragraphSpacing;
      case "widthMode": return settings.widthMode;
      case "pageMargin": return settings.pageMargin;
      case "exportTemplate": return settings.exportTemplate;
      case "customExportTemplatePath": return settings.customExportTemplatePath;
      case "syncEnabled": return settings.syncEnabled;
      case "syncFolder": return settings.syncFolder;
      default: return undefined;
    }
  }

  setControlValue(key: string, value: unknown): void {
    switch (key) {
      case "theme":
        if (value === "auto" || value === "light" || value === "dark" || value === "sepia") {
          this.host.updateReaderSettings({ theme: value });
        }
        return;
      case "layout":
        if (value === "paginated" || value === "scrolled") this.host.updateReaderSettings({ layout: value });
        return;
      case "tapToTurnPages":
        if (typeof value === "boolean") this.host.updateReaderSettings({ tapToTurnPages: value });
        return;
      case "readerChromeAutoHide":
        if (typeof value === "boolean") this.host.updateReaderSettings({ readerChromeAutoHide: value });
        return;
      case "connectAdjacentHighlights":
        if (typeof value === "boolean") this.host.updateReaderSettings({ connectAdjacentHighlights: value });
        return;
      case "interfaceDensity":
        if (value === "comfortable" || value === "compact") this.host.updateReaderSettings({ interfaceDensity: value });
        return;
      case "defaultHighlightColor":
        if (value === "yellow" || value === "green" || value === "blue" || value === "pink") this.host.updateReaderSettings({ defaultHighlightColor: value });
        return;
      case "defaultHighlightStyle":
        if (value === "highlight" || value === "underline" || value === "strikethrough" || value === "squiggly") this.host.updateReaderSettings({ defaultHighlightStyle: value });
        return;
      case "font":
        if (value === "obsidian" || value === "publisher" || value === "serif" || value === "sans") {
          this.host.updateReaderSettings({ font: value });
        }
        return;
      case "widthMode":
        if (value === "standard" || value === "wide" || value === "full" || value === "edge") {
          this.host.updateReaderSettings({ widthMode: value });
        }
        return;
      case "exportTemplate":
        if (value === "classic" || value === "compact" || value === "callout" || value === "custom") {
          this.host.updateReaderSettings({ exportTemplate: value });
        }
        return;
      case "fontSizePercent":
      case "lineHeight":
      case "letterSpacing":
      case "paragraphSpacing":
      case "pageMargin":
        if (typeof value === "number" && Number.isFinite(value)) this.host.updateReaderSettings({ [key]: value });
        return;
      case "customExportTemplatePath":
        if (typeof value === "string") this.host.updateReaderSettings({ customExportTemplatePath: value });
        return;
      case "syncEnabled":
        if (typeof value === "boolean") this.host.updateReaderSettings({ syncEnabled: value });
        return;
      case "syncFolder":
        if (typeof value === "string") this.host.updateReaderSettings({ syncFolder: value });
    }
  }

  display(): void {
    this.renderLegacySettings();
  }

  private renderLegacySettings(): void {
    this.containerEl.empty();
    this.containerEl.addClass("omni-book-reader-settings-page");
    new Setting(this.containerEl).setName("Reading").setHeading();
    renderSettings(this.containerEl, this.host, false);
    new Setting(this.containerEl).setName("Sync across devices").setHeading();
    new Setting(this.containerEl)
      .setName("Sync reading data")
      .setDesc(SYNC_DESCRIPTION)
      .addToggle((toggle) => toggle
        .setValue(this.host.getReaderSettings().syncEnabled)
        .onChange((syncEnabled) => this.host.updateReaderSettings({ syncEnabled })));
    new Setting(this.containerEl)
      .setName("Sync folder")
      .setDesc(SYNC_FOLDER_DESCRIPTION)
      .addText((text) => text
        .setPlaceholder(DEFAULT_SETTINGS.syncFolder)
        .setValue(this.host.getReaderSettings().syncFolder)
        .onChange((syncFolder) => this.host.updateReaderSettings({ syncFolder })));
  }
}
