from typing import List, Optional
import traceback
import logging
import base64
import time

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Lazy import screenshot renderer (sets EGL env var on import)
_screenshot_renderer = None

def _get_screenshot_renderer():
    global _screenshot_renderer
    if _screenshot_renderer is None:
        from app.screenshot_renderer import render_screenshots
        _screenshot_renderer = render_screenshots
    return _screenshot_renderer


@app.get("/")
def read_root():
    return {"service": "screenshot-service", "status": "ok"}


# ── Screenshot rendering (pyrender + EGL) ────────────────────────────


class ScreenshotRequest(BaseModel):
    modelData: str  # base64-encoded STL or 3MF
    format: str = "stl"  # "stl" or "3mf"
    width: int = 512
    height: int = 512
    angles: Optional[List[str]] = None  # default: ["front", "top", "isometric"]


class ScreenshotImage(BaseModel):
    angle: str
    base64: str


class ScreenshotResponse(BaseModel):
    images: List[ScreenshotImage]


@app.post("/render-screenshots/")
def render_screenshots_endpoint(request: ScreenshotRequest):
    """
    Render model screenshots from multiple angles using pyrender + EGL.

    API contract matches the original Build123d endpoint exactly so the
    backend can switch providers transparently.
    """
    t0 = time.time()
    try:
        # Decode base64 model data
        try:
            model_bytes = base64.b64decode(request.modelData)
        except Exception as e:
            return JSONResponse(
                content={"error": f"Invalid base64 modelData: {e}", "type": "client"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        if len(model_bytes) == 0:
            return JSONResponse(
                content={"error": "Empty model data", "type": "client"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        angles = request.angles or ["front", "top", "isometric"]
        valid_angles = {"front", "top", "isometric"}
        angles = [a for a in angles if a in valid_angles]
        if not angles:
            return JSONResponse(
                content={"error": "No valid angles specified", "type": "client"},
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        render_fn = _get_screenshot_renderer()
        images = render_fn(
            model_data=model_bytes,
            format=request.format,
            angles=angles,
            width=request.width,
            height=request.height,
        )

        elapsed = time.time() - t0
        logger.info(
            f"render-screenshots: {len(images)} angles in {elapsed:.2f}s "
            f"(format={request.format}, {request.width}x{request.height})"
        )

        response = ScreenshotResponse(
            images=[ScreenshotImage(angle=img["angle"], base64=img["base64"]) for img in images]
        )
        return JSONResponse(content=response.dict(), status_code=status.HTTP_200_OK)

    except ValueError as e:
        # Bad model data — client error
        logger.warning(f"Screenshot rendering client error: {e}")
        return JSONResponse(
            content={"error": str(e), "type": "client"},
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    except Exception as e:
        error_details = f"Screenshot rendering error: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_details)
        return JSONResponse(
            content={"error": str(e), "type": "server"},
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
