import express from "express";
import { renderModelToImages, RenderError } from "./renderer.js";

type ViewingAngle = "front" | "top" | "isometric";

interface RenderRequestBody {
  modelData?: string;
  format?: string;
  width?: number;
  height?: number;
  angles?: string[];
}

const VALID_FORMATS = ["stl", "3mf"] as const;
const VALID_ANGLES = ["front", "top", "isometric"] as const;

function isValidAngle(angle: string): angle is ViewingAngle {
  return (VALID_ANGLES as readonly string[]).includes(angle);
}

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/render", async (req, res) => {
  const body = req.body as RenderRequestBody;

  if (!body.modelData || typeof body.modelData !== "string") {
    res.status(400).json({ error: "Missing or invalid modelData", type: "client" });
    return;
  }

  if (!body.format || !(VALID_FORMATS as readonly string[]).includes(body.format)) {
    res.status(400).json({
      error: 'Invalid format — must be "stl" or "3mf"',
      type: "client",
    });
    return;
  }

  const angles: ViewingAngle[] = body.angles
    ? body.angles.filter(isValidAngle)
    : ["front", "top", "isometric"];

  if (angles.length === 0) {
    res.status(400).json({ error: "No valid angles specified", type: "client" });
    return;
  }

  try {
    const images = await renderModelToImages({
      modelData: body.modelData,
      format: body.format as "stl" | "3mf",
      width: body.width ?? 512,
      height: body.height ?? 512,
      angles,
    });

    res.json({ images });
  } catch (error) {
    if (error instanceof RenderError) {
      const status = error.type === "client" ? 400 : 500;
      res.status(status).json({ error: error.message, type: error.type });
      return;
    }

    console.error("Unexpected error:", error);
    res.status(500).json({ error: "Renderer unavailable", type: "server" });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`STL Rendering Service listening on port ${PORT}`);
});
