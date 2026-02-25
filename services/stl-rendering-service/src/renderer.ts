import puppeteer, { Browser, Page } from "puppeteer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";
import { createLogger } from "./logger.js";

const logger = createLogger("renderer");

export type ViewingAngle = "front" | "top" | "isometric";

export interface RenderRequest {
  modelData: string;
  format: "stl" | "3mf";
  width: number;
  height: number;
  angles: ViewingAngle[];
}

export interface RenderedImage {
  angle: ViewingAngle;
  base64: string;
}

export class RenderError extends Error {
  public readonly type: "client" | "server";

  constructor(message: string, type: "client" | "server") {
    super(message);
    this.name = "RenderError";
    this.type = type;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATE_PATH = join(__dirname, "templates", "stlRenderer.html");
const RENDER_TIMEOUT_MS = 30_000;
const PUPPETEER_LAUNCH_TIMEOUT_MS = 10_000;
const BROWSER_KILL_GRACE_MS = 2_000;

// ── Shared browser + page ───────────────────────────────────────────

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--enable-webgl",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--ignore-gpu-blocklist",
  "--allow-file-access-from-files",
];

let sharedBrowser: Browser | null = null;
let sharedPage: Page | null = null;

async function getBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.connected) {
    return sharedBrowser;
  }

  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => {});
    sharedBrowser = null;
    sharedPage = null;
  }

  logger.info("launching shared browser");
  sharedBrowser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: BROWSER_ARGS,
    timeout: PUPPETEER_LAUNCH_TIMEOUT_MS,
  });

  sharedBrowser.on("disconnected", () => {
    logger.warn("browser disconnected — will relaunch on next request");
    sharedBrowser = null;
    sharedPage = null;
  });

  return sharedBrowser;
}

async function getReadyPage(width: number, height: number): Promise<Page> {
  const browser = await getBrowser();

  // Reuse the shared page if it's still alive and rendererReady
  if (sharedPage && !sharedPage.isClosed()) {
    try {
      const ready = await sharedPage.evaluate("window.rendererReady === true");
      if (ready) {
        await sharedPage.setViewport({ width, height });
        return sharedPage;
      }
    } catch {
      // Page is broken — discard it
    }
    await sharedPage.close().catch(() => {});
    sharedPage = null;
  }

  logger.info("creating new page + loading template");
  const page = await browser.newPage();
  await page.setViewport({ width, height });

  const templateUrl = `file://${TEMPLATE_PATH}`;
  // Use "load" instead of "networkidle0" — networkidle0 is unreliable with
  // file:// URLs and ES module imports (can hang for minutes).
  // We rely on window.rendererReady to know when Three.js modules are loaded.
  await page.goto(templateUrl, { waitUntil: "load" });
  await page.waitForFunction("window.rendererReady === true", {
    timeout: 30_000,
  });

  sharedPage = page;
  return page;
}

function invalidateSharedPage() {
  if (sharedPage) {
    sharedPage.close().catch(() => {});
    sharedPage = null;
  }
}

/**
 * Force-kill the entire Chromium process.
 * Used when the browser is deadlocked (e.g. SwiftShader hang, WebGL context
 * loss) and DevTools protocol messages like page.close() won't get through.
 * Tries graceful close first, then SIGKILL after BROWSER_KILL_GRACE_MS.
 */
async function killBrowser(): Promise<void> {
  sharedPage = null;
  const browser = sharedBrowser;
  sharedBrowser = null;

  if (!browser) return;

  const pid = browser.process()?.pid;
  logger.warn({ pid: pid ?? "unknown" }, "killing browser");

  try {
    // Attempt graceful close with a short deadline
    await Promise.race([
      browser.close(),
      new Promise((resolve) => setTimeout(resolve, BROWSER_KILL_GRACE_MS)),
    ]);
  } catch {
    // Ignore — browser may already be unresponsive
  }

  // If the process is still alive, SIGKILL it
  if (pid) {
    try {
      process.kill(pid, "SIGKILL");
      logger.warn({ pid }, "sent SIGKILL to browser");
    } catch {
      // Already dead — good
    }
  }
}

// ── Pre-warm ────────────────────────────────────────────────────────

/**
 * Eagerly launch the browser and load the renderer template so the first
 * render request doesn't pay cold-start latency.
 */
export async function warmUp(width = 512, height = 512): Promise<void> {
  logger.info("pre-warming browser + page");
  try {
    await getReadyPage(width, height);
    logger.info("browser pre-warm complete");
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "browser pre-warm failed — will retry on first request",
    );
  }
}

// ── Render function ─────────────────────────────────────────────────

export async function renderModelToImages(
  request: RenderRequest,
): Promise<RenderedImage[]> {
  if (!existsSync(TEMPLATE_PATH)) {
    logger.error({ path: TEMPLATE_PATH }, "HTML template not found");
    throw new RenderError("Renderer unavailable", "server");
  }

  // Validate base64 decodes to non-empty data
  try {
    const decoded = Buffer.from(request.modelData, "base64");
    if (decoded.length === 0) {
      throw new RenderError("Invalid model data", "client");
    }
  } catch (error) {
    if (error instanceof RenderError) throw error;
    throw new RenderError("Invalid model data", "client");
  }

  let usedPage: Page | null = null;

  try {
    const t0 = Date.now();
    const page = await getReadyPage(request.width, request.height);
    usedPage = page;
    const tPage = Date.now();

    // Set model data and render all angles in one call
    await page.evaluate(
      `
      window.modelData = ${JSON.stringify(request.modelData)};
      window.modelFormat = ${JSON.stringify(request.format)};
      window.renderAngles = ${JSON.stringify(request.angles)};
      window.renderOptions = ${JSON.stringify({
        width: request.width,
        height: request.height,
      })};
    `,
    );

    const rawImages = (await Promise.race([
      page.evaluate("window.renderAllAngles()"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Render timeout exceeded")),
          RENDER_TIMEOUT_MS,
        ),
      ),
    ])) as Array<{ angle: string; dataUrl: string }>;

    const tRender = Date.now();
    logger.info(
      { pageMs: tPage - t0, renderMs: tRender - tPage, totalMs: tRender - t0 },
      "render complete",
    );

    const renderedImages: RenderedImage[] = [];
    const base64Prefix = "data:image/png;base64,";
    for (const img of rawImages) {
      if (!img.dataUrl || !img.dataUrl.startsWith(base64Prefix)) {
        throw new RenderError("Invalid model data", "client");
      }
      renderedImages.push({
        angle: img.angle as ViewingAngle,
        base64: img.dataUrl.substring(base64Prefix.length),
      });
    }

    return renderedImages;
  } catch (error) {
    usedPage = null;

    // Re-throw known client errors WITHOUT invalidating the shared page —
    // the page is healthy, only the input data was bad.
    if (error instanceof RenderError) {
      if (error.type === "server") invalidateSharedPage();
      throw error;
    }

    // Classify unknown errors and decide whether page should be invalidated
    if (error instanceof Error) {
      // Browser/launch failures — page is unusable
      if (
        error.message.includes("Failed to launch") ||
        error.message.includes("Browser") ||
        error.message.includes("ENOENT") ||
        error.message.includes("spawn") ||
        error.message.includes("Chromium") ||
        error.message.includes("executablePath")
      ) {
        logger.error({ err: error.message }, "Puppeteer launch failed");
        invalidateSharedPage();
        throw new RenderError("Renderer unavailable", "server");
      }

      // Timeouts — browser is likely deadlocked, force-kill it
      if (
        error.message.includes("timeout") ||
        error.message.includes("Timeout") ||
        error.message === "Render timeout exceeded"
      ) {
        logger.error("render timeout exceeded — killing browser");
        killBrowser().catch(() => {});
        throw new RenderError("Render timeout exceeded", "server");
      }

      // Parse/loader errors — bad model data, page is fine
      if (
        error.message.includes("Loader") ||
        error.message.includes("parse") ||
        error.message.includes("Invalid render output") ||
        error.message.includes("RangeError") ||
        error.message.includes("DataView") ||
        error.message.includes("offset") ||
        error.message.includes("bounds")
      ) {
        throw new RenderError("Invalid model data", "client");
      }
    }

    // Unknown error — invalidate as a precaution
    logger.error({ err: error }, "unexpected renderer error");
    invalidateSharedPage();
    throw new RenderError("Renderer unavailable", "server");
  }
  // Note: we do NOT close the page here — it's reused for subsequent requests
}
