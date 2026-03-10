/**
 * Visual Evaluation Zoom Tools
 *
 * Defines the request_detail_view tool for VLM-guided zoom during evaluation.
 * The tool renders a zoomed-in screenshot of the model from a specific angle
 * so the VLM can inspect fine details (threads, teeth, small features).
 */

import { zodSchema } from "ai";
import { z } from "zod";
import { renderModelScreenshots, type ViewingAngle, type ModelFormat, type RenderedScreenshot } from "./stl-rendering-client.service.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("vlm-zoom");

/** Maximum number of zoom requests per evaluation */
export const MAX_ZOOM_REQUESTS = 2;

/** Detail view tool arguments as parsed from the VLM's tool call */
export interface ZoomToolArgs {
  angle: string;
  reason: string;
}

/**
 * Build the request_detail_view tool with an execute function that captures
 * detail view requests into the provided array. Uses tighter framing + higher
 * resolution (1024px) instead of zoom_factor to avoid clipping model edges.
 */
export function buildZoomToolWithCapture(capturedRequests: ZoomToolArgs[]) {
  return {
    request_detail_view: {
      type: "function" as const,
      description:
        "Request a high-resolution detail view from a specific angle. Renders at 1024px " +
        "with tight framing (model fills ~90% of frame) giving ~3x more pixel density than " +
        "the standard views. Use when you need to inspect fine details like thread pitch, " +
        "gear teeth, drive recesses, chamfers, or other small features.",
      inputSchema: zodSchema(
        z.object({
          angle: z.enum(["front", "back", "left", "right", "top", "bottom"])
            .describe("Viewing angle for the detail shot"),
          reason: z.string()
            .describe("Why you need this detail view (e.g., 'inspect thread pitch detail')"),
        }),
      ),
      execute: async (args: ZoomToolArgs) => {
        logger.info({ angle: args.angle, reason: args.reason }, "detail view requested by VLM");
        capturedRequests.push(args);
        return "Detail view request recorded. The high-resolution image will be provided in a follow-up message.";
      },
    },
  };
}

/**
 * Render a high-resolution detail view of a model from a specific angle.
 * Uses tight framing (zoom_factor ~1.55 to fill ~91% of frame) at 1024px
 * for ~3x pixel density vs standard 512px views. No clipping.
 */
export async function renderZoomedScreenshot(input: {
  modelData: string;
  format: ModelFormat;
  angle: ViewingAngle;
}): Promise<RenderedScreenshot | null> {
  const { modelData, format, angle } = input;
  // Tight framing: normal ortho_half = extent*0.85, we want extent*0.55
  // zoom_factor = 0.85/0.55 ≈ 1.545 gives ~91% frame fill
  const zoomFactor = 1.55;
  const width = 1024;
  const height = 1024;

  logger.info({ angle, zoomFactor, width, format }, "rendering detail view");

  try {
    const result = await renderModelScreenshots({
      modelData,
      format,
      width,
      height,
      angles: [angle],
      zoomFactor,
    });

    if (result.images.length > 0) {
      logger.info({ angle, zoomFactor }, "zoomed screenshot rendered");
      return result.images[0];
    }

    logger.warn({ angle, zoomFactor }, "no image returned from zoomed render");
    return null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), angle, zoomFactor }, "zoomed screenshot failed");
    return null;
  }
}
