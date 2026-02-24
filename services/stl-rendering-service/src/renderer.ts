import puppeteer, { Browser, Page } from "puppeteer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync } from "fs";

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
const RENDER_TIMEOUT_MS = 120_000;
const PUPPETEER_LAUNCH_TIMEOUT_MS = 10_000;

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

  console.log("[renderer] launching shared browser");
  sharedBrowser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: BROWSER_ARGS,
    timeout: PUPPETEER_LAUNCH_TIMEOUT_MS,
  });

  sharedBrowser.on("disconnected", () => {
    console.warn("[renderer] browser disconnected — will relaunch on next request");
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

  console.log("[renderer] creating new page + loading template");
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

// ── Render function ─────────────────────────────────────────────────

export async function renderModelToImages(
  request: RenderRequest,
): Promise<RenderedImage[]> {
  if (!existsSync(TEMPLATE_PATH)) {
    console.error("HTML template not found at", TEMPLATE_PATH);
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
    console.log(
      `[renderer] done — page=${tPage - t0}ms render=${tRender - tPage}ms total=${tRender - t0}ms`,
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
    // After any error, invalidate the shared page so next request starts clean
    invalidateSharedPage();
    usedPage = null;

    if (error instanceof RenderError) throw error;

    if (error instanceof Error) {
      if (
        error.message.includes("Failed to launch") ||
        error.message.includes("Browser") ||
        error.message.includes("ENOENT") ||
        error.message.includes("spawn") ||
        error.message.includes("Chromium") ||
        error.message.includes("executablePath")
      ) {
        console.error("Puppeteer launch failed:", error.message);
        throw new RenderError("Renderer unavailable", "server");
      }

      if (
        error.message.includes("timeout") ||
        error.message.includes("Timeout") ||
        error.message === "Render timeout exceeded"
      ) {
        console.error("Render timeout exceeded");
        throw new RenderError("Render timeout exceeded", "server");
      }

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

    console.error("Renderer error:", error);
    throw new RenderError("Renderer unavailable", "server");
  }
  // Note: we do NOT close the page here — it's reused for subsequent requests
}
