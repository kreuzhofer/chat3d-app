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
const RENDER_TIMEOUT_MS = 30_000;
const PUPPETEER_LAUNCH_TIMEOUT_MS = 10_000;

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

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--ignore-gpu-blocklist",
      ],
      timeout: PUPPETEER_LAUNCH_TIMEOUT_MS,
    });

    page = await browser.newPage();
    await page.setViewport({ width: request.width, height: request.height });

    const templateUrl = `file://${TEMPLATE_PATH}`;
    await page.goto(templateUrl, { waitUntil: "networkidle0" });

    await page.waitForFunction("window.rendererReady === true", {
      timeout: RENDER_TIMEOUT_MS,
    });

    const renderedImages: RenderedImage[] = [];

    for (let i = 0; i < request.angles.length; i++) {
      const angle = request.angles[i];

      await page.evaluate(
        `
        window.modelData = ${JSON.stringify(request.modelData)};
        window.modelFormat = ${JSON.stringify(request.format)};
        window.renderOptions = ${JSON.stringify({
          width: request.width,
          height: request.height,
          angle,
        })};
      `,
      );

      const dataUrl = (await Promise.race([
        page.evaluate("window.renderImage()"),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Render timeout exceeded")),
            RENDER_TIMEOUT_MS,
          ),
        ),
      ])) as string;

      const base64Prefix = "data:image/png;base64,";
      if (!dataUrl || !dataUrl.startsWith(base64Prefix)) {
        throw new RenderError("Invalid model data", "client");
      }

      const base64 = dataUrl.substring(base64Prefix.length);
      renderedImages.push({ angle, base64 });

      // Reload page for clean state between renders (skip after last)
      if (i < request.angles.length - 1) {
        await page.reload({ waitUntil: "networkidle0" });
        await page.waitForFunction("window.rendererReady === true", {
          timeout: RENDER_TIMEOUT_MS,
        });
      }
    }

    return renderedImages;
  } catch (error) {
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
        error.message.includes("Invalid render output")
      ) {
        throw new RenderError("Invalid model data", "client");
      }
    }

    console.error("Renderer error:", error);
    throw new RenderError("Renderer unavailable", "server");
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
