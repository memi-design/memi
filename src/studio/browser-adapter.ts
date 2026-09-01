import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getExecutionPolicy } from "../security/execution-policy.js";
import type {
  StudioBrowserActionRequest,
  StudioBrowserActionResult,
  StudioBrowserSession,
  StudioBrowserStatus,
} from "./types.js";

const PLAYWRIGHT_INSTALL_COMMAND = "npm install --save-exact playwright@1.59.1";

interface PlaywrightPage {
  url(): string;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  title(): Promise<string>;
  content(): Promise<string>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, text: string): Promise<unknown>;
  close(): Promise<unknown>;
}

interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<unknown>;
}

interface PlaywrightModule {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<PlaywrightBrowser>;
  };
}

type PlaywrightLoader = () => Promise<PlaywrightModule>;

interface BrowserRecord {
  session: StudioBrowserSession;
  browser: PlaywrightBrowser;
  page: PlaywrightPage;
}

export interface StudioBrowserAdapterOptions {
  projectRoot: string;
  playwrightLoader?: PlaywrightLoader;
  playwrightPresenceProbe?: () => boolean;
}

export class StudioBrowserAdapter {
  private readonly projectRoot: string;
  private readonly playwrightLoader: PlaywrightLoader;
  private readonly playwrightPresenceProbe: () => boolean;
  private readonly sessions = new Map<string, BrowserRecord>();

  constructor(options: StudioBrowserAdapterOptions) {
    this.projectRoot = options.projectRoot;
    this.playwrightLoader = options.playwrightLoader ?? defaultPlaywrightLoader;
    this.playwrightPresenceProbe = options.playwrightPresenceProbe
      ?? (options.playwrightLoader ? () => true : defaultPlaywrightPresenceProbe);
  }

  async status(enabled = true): Promise<StudioBrowserStatus> {
    const integrationAllowed = getExecutionPolicy().allows("host-integration-code");
    const installed = integrationAllowed
      ? await this.canLoadPlaywright()
      : this.playwrightPresenceProbe();
    return {
      enabled,
      installed,
      activeSessions: this.sessions.size,
      message: !integrationAllowed
        ? `Playwright host integration code is disabled. Re-run with --profile connected --allow host-integration-code. If Playwright is not installed, run \`${PLAYWRIGHT_INSTALL_COMMAND}\`.`
        : installed
        ? "Playwright browser adapter ready"
        : `Playwright is not installed. Run \`${PLAYWRIGHT_INSTALL_COMMAND}\` to enable browser automation.`,
    };
  }

  async createSession(input: { url?: string | null } = {}): Promise<StudioBrowserSession> {
    const playwright = await this.loadPlaywrightOrThrow();
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    const sessionId = `browser-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const artifactDir = join(this.projectRoot, ".memoire", "studio", "artifacts", "browser", sessionId);
    await mkdir(artifactDir, { recursive: true });
    if (input.url) await page.goto(input.url, { waitUntil: "networkidle" });
    const now = new Date().toISOString();
    const session: StudioBrowserSession = {
      id: sessionId,
      url: page.url(),
      status: "active",
      createdAt: now,
      updatedAt: now,
      artifactDir,
    };
    this.sessions.set(session.id, { session, browser, page });
    return session;
  }

  async runAction(request: StudioBrowserActionRequest): Promise<StudioBrowserActionResult> {
    if (request.action === "open") {
      const session = request.sessionId
        ? await this.navigateExistingSession(request.sessionId, requiredString(request.url, "url"))
        : await this.createSession({ url: requiredString(request.url, "url") });
      return this.result(request.action, session, { url: session.url }, null);
    }

    const record = this.getRecord(request.sessionId);
    if (request.action === "snapshot") {
      const [title, html] = await Promise.all([record.page.title(), record.page.content()]);
      this.touch(record);
      return this.result(request.action, record.session, {
        url: record.page.url(),
        title,
        html,
      }, null);
    }

    if (request.action === "screenshot") {
      const path = join(record.session.artifactDir, `${Date.now()}-screenshot.png`);
      await mkdir(record.session.artifactDir, { recursive: true });
      await record.page.screenshot({ path, fullPage: true });
      this.touch(record);
      return this.result(request.action, record.session, { url: record.page.url() }, path);
    }

    if (request.action === "click") {
      await record.page.click(requiredString(request.selector, "selector"));
      this.touch(record);
      return this.result(request.action, record.session, { selector: request.selector }, null);
    }

    if (request.action === "type") {
      await record.page.fill(requiredString(request.selector, "selector"), requiredString(request.text, "text"));
      this.touch(record);
      return this.result(request.action, record.session, { selector: request.selector }, null);
    }

    if (request.action === "close") {
      await record.page.close();
      await record.browser.close();
      record.session.status = "closed";
      this.sessions.delete(record.session.id);
      this.touch(record);
      return this.result(request.action, record.session, { closed: true }, null);
    }

    throw Object.assign(new Error(`Unknown browser action: ${request.action}`), { statusCode: 400 });
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.sessions.values()).map(async (record) => {
      await record.page.close().catch(() => undefined);
      await record.browser.close().catch(() => undefined);
    }));
    this.sessions.clear();
  }

  private async navigateExistingSession(sessionId: string, url: string): Promise<StudioBrowserSession> {
    const record = this.getRecord(sessionId);
    await record.page.goto(url, { waitUntil: "networkidle" });
    record.session.url = record.page.url();
    this.touch(record);
    return record.session;
  }

  private getRecord(sessionId: string | undefined): BrowserRecord {
    if (!sessionId) throw Object.assign(new Error("Browser session id is required"), { statusCode: 400 });
    const record = this.sessions.get(sessionId);
    if (!record) throw Object.assign(new Error(`Unknown browser session: ${sessionId}`), { statusCode: 404 });
    return record;
  }

  private result(
    action: StudioBrowserActionRequest["action"],
    session: StudioBrowserSession,
    result: unknown,
    artifactPath: string | null,
  ): StudioBrowserActionResult {
    return {
      action,
      sessionId: session.id,
      status: "completed",
      completedAt: new Date().toISOString(),
      result,
      artifactPath,
    };
  }

  private touch(record: BrowserRecord): void {
    record.session.url = record.page.url();
    record.session.updatedAt = new Date().toISOString();
  }

  private async canLoadPlaywright(): Promise<boolean> {
    try {
      await this.playwrightLoader();
      return true;
    } catch {
      return false;
    }
  }

  private async loadPlaywrightOrThrow(): Promise<PlaywrightModule> {
    getExecutionPolicy().assert("host-integration-code", "load the optional Playwright runtime");
    try {
      return await this.playwrightLoader();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(
        `MEMI_OPTIONAL_INTEGRATION_MISSING: Playwright browser adapter unavailable. Run \`${PLAYWRIGHT_INSTALL_COMMAND}\`. ${message}`,
      ), { statusCode: 501 });
    }
  }
}

async function defaultPlaywrightLoader(): Promise<PlaywrightModule> {
  const require = createRequire(import.meta.url);
  return require("playwright") as PlaywrightModule;
}

function defaultPlaywrightPresenceProbe(): boolean {
  const require = createRequire(import.meta.url);
  try {
    require.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw Object.assign(new Error(`Browser action requires ${name}`), { statusCode: 400 });
}
