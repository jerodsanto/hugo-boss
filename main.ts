import {
  Notice,
  Plugin,
  PluginSettingTab,
  App,
  Setting,
  TFile,
  ItemView,
  WorkspaceLeaf,
  Menu,
  setIcon,
  FuzzySuggestModal,
  ViewStateResult,
} from "obsidian";
import { ChildProcess, spawn } from "child_process";
import * as path from "path";

const PREVIEW_VIEW_TYPE = "hugo-boss-preview";
const HUGO_SERVER_STARTUP_DELAY_MS = 2000;

interface WebviewElement extends HTMLElement {
  loadURL?: (url: string) => void;
  reload?: () => void;
}

interface HugoBossSettings {
  hugoSiteDir: string;
  hugoBinary: string;
  syncCommand: string;
  obsidianHugoDir: string;
  draftTemplate: string;
  publishPath: string;
  hugoServerPort: number;
}

const DEFAULT_SETTINGS: HugoBossSettings = {
  hugoSiteDir: "",
  hugoBinary: "",
  syncCommand: "",
  obsidianHugoDir: "",
  draftTemplate: "",
  publishPath: "{YYYY}/{MM}-{slug}",
  hugoServerPort: 1313,
};

export default class HugoBossPlugin extends Plugin {
  private buttons: HTMLElement[] = [];
  private previewButtons: HTMLElement[] = [];
  private hugoServerProcess: ChildProcess | null = null;
  settings: HugoBossSettings;
  pendingPreviewUrl: string = "";

  getBaseUrl(): string {
    const port = this.settings.hugoServerPort || 1313;
    return `http://localhost:${port}`;
  }

  private expandHomePath(filePath: string): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    return filePath.replace(/^~/, homeDir);
  }

  private getShellEnvironment(): { shell: string; homeDir: string } {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const shell = process.env.SHELL || "/bin/zsh";
    return { shell, homeDir };
  }

  private formatDateParts(date: Date): { year: string; month: string; day: string } {
    return {
      year: date.getFullYear().toString(),
      month: (date.getMonth() + 1).toString().padStart(2, "0"),
      day: date.getDate().toString().padStart(2, "0"),
    };
  }

  isValidPreviewUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  private isPathSafe(targetPath: string, baseDir: string): boolean {
    const normalizedTarget = path.normalize(targetPath);
    const normalizedBase = path.normalize(baseDir);
    if (normalizedTarget.includes("..")) {
      return false;
    }
    return normalizedTarget.startsWith(normalizedBase) || !baseDir;
  }

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new HugoBossSettingTab(this.app, this));

    this.registerView(
      PREVIEW_VIEW_TYPE,
      (leaf) => new HugoPreviewView(leaf, this),
    );

    this.app.workspace.onLayoutReady(() => {
      this.addButtonsToAllViews();
    });

    // Add button when new leaves are created
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.addButtonsToAllViews();
      }),
    );
  }

  onunload() {
    this.buttons.forEach((btn) => btn.remove());
    this.buttons = [];
    this.previewButtons = [];
    this.stopHugoServer();
  }

  private updatePreviewButtonState(active: boolean) {
    this.previewButtons.forEach((btn) => {
      if (active) {
        btn.addClass("is-active");
      } else {
        btn.removeClass("is-active");
      }
    });
  }

  private stopHugoServer() {
    if (this.hugoServerProcess) {
      this.hugoServerProcess.kill();
      this.hugoServerProcess = null;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private addButtonsToAllViews() {
    // Find all view-actions containers and add button if not already present
    const viewActions = document.querySelectorAll(".view-actions");

    viewActions.forEach((container) => {
      // Add Hugo Boss menu button if not present
      if (!container.querySelector(".hugo-boss-button")) {
        const menuButton = document.createElement("div");
        menuButton.addClass(
          "hugo-boss-button",
          "clickable-icon",
          "view-action",
        );
        menuButton.setAttribute("aria-label", "Hugo Boss");
        setIcon(menuButton, "biceps-flexed");

        menuButton.addEventListener("click", (event) => {
          this.showMenu(event);
        });

        container.insertBefore(menuButton, container.firstChild);
        this.buttons.push(menuButton);
        this.previewButtons.push(menuButton);

        // Set initial state if server is running
        if (this.hugoServerProcess) {
          menuButton.addClass("is-active");
        }
      }
    });
  }

  private showMenu(event: MouseEvent) {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle("New post")
        .setIcon("file-plus")
        .onClick(() => {
          this.createNewDraft();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(this.hugoServerProcess ? "Stop preview" : "Preview site")
        .setIcon("play-circle")
        .onClick(() => {
          this.togglePreview();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Publish post")
        .setIcon("rocket")
        .onClick(() => {
          this.publishCurrentFile();
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Deploy site")
        .setIcon("refresh-cw")
        .onClick(() => {
          this.syncHugo();
        });
    });

    menu.showAtMouseEvent(event);
  }

  private async createNewDraft() {
    const blogDir = this.settings.obsidianHugoDir;

    // Ensure blog directory exists
    if (blogDir && !this.app.vault.getAbstractFileByPath(blogDir)) {
      await this.app.vault.createFolder(blogDir);
    }

    // Generate unique filename
    const baseName = "Untitled";
    let fileName = `${baseName}.md`;
    let filePath = blogDir ? `${blogDir}/${fileName}` : fileName;
    let counter = 1;

    while (this.app.vault.getAbstractFileByPath(filePath)) {
      fileName = `${baseName} ${counter}.md`;
      filePath = blogDir ? `${blogDir}/${fileName}` : fileName;
      counter++;
    }

    // Get content from template or use default frontmatter
    let content: string;

    if (this.settings.draftTemplate) {
      const templateFile = this.app.vault.getAbstractFileByPath(
        this.settings.draftTemplate,
      );
      if (templateFile instanceof TFile) {
        content = await this.app.vault.read(templateFile);
      } else {
        new Notice(`Template not found: ${this.settings.draftTemplate}`);
        content = this.getDefaultDraftContent();
      }
    } else {
      content = this.getDefaultDraftContent();
    }

    // Create the file
    const newFile = await this.app.vault.create(filePath, content);

    // Open the new file
    const leaf = this.app.workspace.getLeaf();
    await leaf.openFile(newFile);

    new Notice("New post created");
  }

  private getDefaultDraftContent(): string {
    return `---
title: ""
draft: true
---

`;
  }

  private togglePreview(): void {
    // If server is running, stop it and close preview
    if (this.hugoServerProcess) {
      this.stopHugoServer();
      this.closePreviewPane();
      this.updatePreviewButtonState(false);
      new Notice("Hugo preview stopped");
      return;
    }

    if (!this.settings.hugoSiteDir) {
      new Notice("Hugo site directory not configured. Check plugin settings.");
      return;
    }

    const { shell } = this.getShellEnvironment();
    const siteDir = this.expandHomePath(this.settings.hugoSiteDir);
    const hugoBinary = this.settings.hugoBinary || "hugo";
    const port = this.settings.hugoServerPort || 1313;

    new Notice("Starting Hugo server...");

    // Start hugo server using spawn with array arguments to prevent command injection
    const hugoArgs = ["server", "-s", siteDir, "--buildDrafts", "--port", port.toString()];
    this.hugoServerProcess = spawn(shell, ["-i", "-c", `"${hugoBinary}" ${hugoArgs.join(" ")}`]);

    this.hugoServerProcess.on("close", () => {
      this.hugoServerProcess = null;
    });

    // Get URL for current file
    const previewUrl = this.getPreviewUrlForActiveFile();

    // Wait for server to start, then open preview
    setTimeout(() => {
      void this.openPreviewPane(previewUrl).then(() => {
        this.updatePreviewButtonState(true);
        new Notice("Hugo preview started");
      });
    }, HUGO_SERVER_STARTUP_DELAY_MS);
  }

  private getPreviewUrlForActiveFile(): string {
    const baseUrl = this.getBaseUrl();
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile || activeFile.extension !== "md") {
      return baseUrl;
    }

    // Check if file is in blog directory
    const blogDir = this.settings.obsidianHugoDir;
    const blogPrefix = blogDir ? `${blogDir}/` : "";
    if (blogPrefix && !activeFile.path.startsWith(blogPrefix)) {
      return baseUrl;
    }

    // Get frontmatter to determine URL
    const metadata = this.app.metadataCache.getFileCache(activeFile);
    const frontmatter = metadata?.frontmatter;

    // Get slug from frontmatter, or slugify the title
    const slug =
      frontmatter?.slug ||
      this.slugify(frontmatter?.title || activeFile.basename);

    // Get date from frontmatter
    let year = "1";
    let month = "01";

    if (frontmatter?.date) {
      const date = new Date(frontmatter.date);
      if (!isNaN(date.getTime())) {
        const parts = this.formatDateParts(date);
        year = parts.year;
        month = parts.month;
      }
    }

    return `${baseUrl}/${year}/${month}/${slug}/`;
  }

  private closePreviewPane() {
    const existing = this.app.workspace.getLeavesOfType(PREVIEW_VIEW_TYPE);
    existing.forEach((leaf) => leaf.detach());
  }

  private async openPreviewPane(url: string) {
    this.pendingPreviewUrl = url;

    // Open in right split
    const leaf = this.app.workspace.getLeaf("split", "vertical");
    await leaf.setViewState({
      type: PREVIEW_VIEW_TYPE,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private syncHugo(): void {
    if (!this.settings.hugoSiteDir) {
      new Notice("Hugo site directory not configured. Check plugin settings.");
      return;
    }

    const { shell } = this.getShellEnvironment();
    const siteDir = this.expandHomePath(this.settings.hugoSiteDir);
    const hugoBinary = this.settings.hugoBinary || "hugo";

    new Notice("Running Hugo...");

    // Use spawn with array arguments to prevent command injection
    const hugoProcess = spawn(shell, ["-i", "-c", `"${hugoBinary}" -s "${siteDir}"`]);

    hugoProcess.on("close", (code) => {
      if (code !== 0) {
        new Notice("Hugo build failed");
        return;
      }

      new Notice("Hugo site rebuilt");

      // Run sync command if configured
      if (this.settings.syncCommand) {
        this.runSyncCommand();
      } else {
        new Notice("Configure deploy command");
      }
    });

    hugoProcess.on("error", () => {
      new Notice("Hugo build failed");
    });
  }

  private runSyncCommand() {
    const { shell } = this.getShellEnvironment();
    const syncCmd = this.expandHomePath(this.settings.syncCommand);
    const siteDir = this.expandHomePath(this.settings.hugoSiteDir);

    new Notice("Syncing...");

    // Use spawn with array arguments to prevent command injection
    const syncProcess = spawn(shell, ["-i", "-c", syncCmd], { cwd: siteDir });

    syncProcess.on("close", (code) => {
      if (code !== 0) {
        new Notice("Sync failed");
        return;
      }
      new Notice("Sync complete!");
    });

    syncProcess.on("error", () => {
      new Notice("Sync failed");
    });
  }

  private async publishCurrentFile() {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
      new Notice("Active file is not a markdown file");
      return;
    }

    // Check for title in frontmatter
    const metadata = this.app.metadataCache.getFileCache(activeFile);
    const title = metadata?.frontmatter?.title;

    if (!title || title.trim() === "") {
      new Notice("Post needs a title");
      return;
    }

    // Check for body content after frontmatter
    const content = await this.app.vault.read(activeFile);
    const frontmatterEnd = metadata?.frontmatterPosition?.end?.line ?? -1;
    const lines = content.split("\n");
    const bodyContent = lines
      .slice(frontmatterEnd + 1)
      .join("\n")
      .trim();

    if (!bodyContent) {
      new Notice("Post needs some content");
      return;
    }

    const now = new Date();
    const timestamp = now.toISOString();

    // Get slug from frontmatter or slugify the title
    const slug = metadata?.frontmatter?.slug || this.slugify(title);

    // Build target path from template (without extension)
    const basePath = this.buildPublishPath(now, slug);

    if (!basePath) {
      new Notice("Invalid publish path configuration");
      return;
    }

    // Check for embedded assets
    const embeddedAssets = this.getEmbeddedAssets(activeFile);
    const isPageBundle = embeddedAssets.length > 0;

    // Determine final target path
    const targetPath = isPageBundle ? `${basePath}/index.md` : `${basePath}.md`;

    await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
      frontmatter.date = timestamp;
      frontmatter.draft = false;
    });

    // Ensure the target directory exists
    const targetDir = isPageBundle
      ? basePath
      : targetPath.substring(0, targetPath.lastIndexOf("/"));
    if (targetDir && !this.app.vault.getAbstractFileByPath(targetDir)) {
      await this.app.vault.createFolder(targetDir);
    }

    // Move embedded assets to the page bundle directory
    if (isPageBundle) {
      for (const asset of embeddedAssets) {
        const assetTargetPath = `${basePath}/${asset.name}`;
        if (asset.path !== assetTargetPath) {
          await this.app.fileManager.renameFile(asset, assetTargetPath);
        }
      }
    }

    // Move the markdown file
    if (activeFile.path !== targetPath) {
      await this.app.fileManager.renameFile(activeFile, targetPath);
    }

    const assetCount = embeddedAssets.length;
    const assetMsg =
      assetCount > 0 ? ` (with ${assetCount} asset${assetCount > 1 ? "s" : ""})` : "";
    new Notice(`Published${assetMsg}!`);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private getEmbeddedAssets(file: TFile): TFile[] {
    const metadata = this.app.metadataCache.getFileCache(file);
    const embeds = metadata?.embeds || [];
    const assets: TFile[] = [];

    for (const embed of embeds) {
      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
        embed.link,
        file.path,
      );
      if (linkedFile instanceof TFile && linkedFile.extension !== "md") {
        assets.push(linkedFile);
      }
    }

    return assets;
  }

  private buildPublishPath(date: Date, slug: string): string | null {
    const { year, month, day } = this.formatDateParts(date);

    const template = this.settings.publishPath || "{YYYY}/{MM}-{slug}";
    const relativePath = template
      .replace("{YYYY}", year)
      .replace("{MM}", month)
      .replace("{DD}", day)
      .replace("{slug}", slug);

    // Validate path doesn't contain traversal attempts
    if (relativePath.includes("..") || path.isAbsolute(relativePath)) {
      return null;
    }

    const blogDir = this.settings.obsidianHugoDir;
    const fullPath = blogDir ? `${blogDir}/${relativePath}` : relativePath;

    // Verify the path stays within the blog directory
    if (blogDir && !this.isPathSafe(fullPath, blogDir)) {
      return null;
    }

    return fullPath;
  }
}

class HugoPreviewView extends ItemView {
  private webviewEl: WebviewElement | null = null;
  private currentUrl: string = "";
  private plugin: HugoBossPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: HugoBossPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return PREVIEW_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Hugo preview";
  }

  getIcon(): string {
    return "play-circle";
  }

  private setWebviewUrl(url: string): void {
    if (!this.webviewEl || !this.plugin.isValidPreviewUrl(url)) {
      return;
    }

    if (this.webviewEl.loadURL) {
      this.webviewEl.loadURL(url);
    } else {
      this.webviewEl.setAttribute("src", url);
    }
  }

  async setState(state: { url?: string }, result: ViewStateResult): Promise<void> {
    if (state.url && this.plugin.isValidPreviewUrl(state.url)) {
      this.currentUrl = state.url;
      this.setWebviewUrl(this.currentUrl);
    }
    await super.setState(state, result);
  }

  getState() {
    return { url: this.currentUrl };
  }

  onOpen(): Promise<void> {
    // Get URL from plugin with validation
    const pendingUrl = this.plugin.pendingPreviewUrl || this.plugin.getBaseUrl();
    this.currentUrl = this.plugin.isValidPreviewUrl(pendingUrl)
      ? pendingUrl
      : this.plugin.getBaseUrl();

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("hugo-preview-container");

    // Create webview element
    this.webviewEl = document.createElement("webview") as WebviewElement;
    this.webviewEl.setAttribute("src", this.currentUrl);
    this.webviewEl.addClass("hugo-preview-webview");

    container.appendChild(this.webviewEl);
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    if (this.webviewEl) {
      this.webviewEl.remove();
      this.webviewEl = null;
    }
    return Promise.resolve();
  }

  refresh() {
    if (this.webviewEl) {
      if (this.webviewEl.reload) {
        this.webviewEl.reload();
      } else {
        this.setWebviewUrl(this.currentUrl);
      }
    }
  }
}

class HugoBossSettingTab extends PluginSettingTab {
  plugin: HugoBossPlugin;

  constructor(app: App, plugin: HugoBossPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl)
      .setName("Hugo site directory")
      .setDesc("The path to your Hugo site (where the hugo command executes)")
      .addText((text) =>
        text
          .setPlaceholder("/path/to/hugo/site")
          .setValue(this.plugin.settings.hugoSiteDir)
          .onChange(async (value) => {
            this.plugin.settings.hugoSiteDir = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Obsidian Hugo directory")
      .setDesc(
        "Where Obsidian stores your Hugo posts (leave empty for vault root)",
      )
      .addText((text) =>
        text
          .setPlaceholder("blog")
          .setValue(this.plugin.settings.obsidianHugoDir)
          .onChange(async (value) => {
            this.plugin.settings.obsidianHugoDir = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Publish path")
      .setDesc(
        "Path template for published posts. Placeholders: {YYYY}, {MM}, {DD}, {slug}",
      )
      .addText((text) =>
        text
          .setPlaceholder("{YYYY}/{MM}-{slug}")
          .setValue(this.plugin.settings.publishPath)
          .onChange(async (value) => {
            this.plugin.settings.publishPath = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hugo binary")
      .setDesc("The path to your Hugo binary (leave empty to use system PATH)")
      .addText((text) =>
        text
          .setPlaceholder("/opt/homebrew/bin/hugo")
          .setValue(this.plugin.settings.hugoBinary)
          .onChange(async (value) => {
            this.plugin.settings.hugoBinary = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hugo server port")
      .setDesc("Port for the Hugo preview server (default: 1313)")
      .addText((text) =>
        text
          .setPlaceholder("1313")
          .setValue(this.plugin.settings.hugoServerPort?.toString() || "1313")
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.hugoServerPort = port;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName("Deploy command")
      .setDesc("Command to run after Hugo builds (e.g., rsync to deploy)")
      .addText((text) =>
        text
          .setPlaceholder("rsync -az public/ user@host:~/site/")
          .setValue(this.plugin.settings.syncCommand)
          .onChange(async (value) => {
            this.plugin.settings.syncCommand = value;
            await this.plugin.saveSettings();
          }),
      );

    const templateSetting = new Setting(containerEl)
      .setName("Draft template")
      .setDesc(
        "Template to use for new posts (leave empty for basic frontmatter)",
      );

    const templateDisplay = templateSetting.controlEl.createSpan({
      text: this.plugin.settings.draftTemplate || "None",
      cls: "hugo-boss-template-display",
    });

    templateSetting
      .addButton((button) => {
        button.setButtonText("Choose").onClick(() => {
          new TemplateSuggestModal(this.app, this.plugin, () => {
            templateDisplay.setText(
              this.plugin.settings.draftTemplate || "None",
            );
          }).open();
        });
      })
      .addExtraButton((button) => {
        button
          .setIcon("x")
          .setTooltip("Clear template")
          .onClick(async () => {
            this.plugin.settings.draftTemplate = "";
            await this.plugin.saveSettings();
            templateDisplay.setText("None");
          });
      });
  }
}

class TemplateSuggestModal extends FuzzySuggestModal<TFile> {
  plugin: HugoBossPlugin;
  onChoose: () => void;

  constructor(app: App, plugin: HugoBossPlugin, onChoose: () => void) {
    super(app);
    this.plugin = plugin;
    this.onChoose = onChoose;
  }

  getItems(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.plugin.settings.draftTemplate = item.path;
    void this.plugin.saveSettings().then(() => {
      this.onChoose();
    });
  }
}
