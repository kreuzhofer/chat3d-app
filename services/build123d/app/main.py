from typing import Union, List, Optional
import os
import traceback
import logging
import base64
import glob
import time

from fastapi import FastAPI, HTTPException, status
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

class RenderRequest(BaseModel):
    code: str
    filename: str = "output.step"

class FileData(BaseModel):
    filename: str
    content: str  # base64 encoded binary content

class RenderResponse(BaseModel):
    success: bool
    files: List[FileData] = []
    message: str = ""

@app.get("/")
def read_root():
    return {"Hello": "World 4"}

@app.get("/items/{item_id}")
def read_item(item_id: int, q: Union[str, None] = None):
    return {"item_id": item_id, "q": q}

@app.get("/render/")
def render():
    try:
        # Code block to execute as eval from string
        code_to_execute = """
from build123d import *
with BuildPart() as box_builder:
    Box(10, 10, 10)
    export_step(box_builder.part, "box.step")
"""
        
        # Execute the code block (explicit globals dict fixes scoping for nested functions)
        exec(code_to_execute, {})
        
        # Find all files starting with "box" (without extension)
        base_filename = "box"
        pattern = f"{base_filename}*"
        matching_files = glob.glob(pattern)
        
        files_data = []
        for file_path in matching_files:
            if os.path.isfile(file_path):
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                encoded_content = base64.b64encode(file_content).decode('utf-8')
                files_data.append(FileData(
                    filename=os.path.basename(file_path),
                    content=encoded_content
                ))
                # Clean up the file after reading
                os.remove(file_path)
        
        response = RenderResponse(
            success=True,
            files=files_data,
            message=f"Successfully generated {len(files_data)} file(s)"
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_200_OK
        )
        
    except Exception as e:
        error_details = f"Execution error: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )

@app.post("/render/")
def render_post(request: RenderRequest):
    try:
        logger.info(f"Starting render_post for file: {request.filename}")
        # Execute the provided code
        logger.info(f"Executing code: {request.code}")
        exec(request.code, {})
        
        # Extract base filename without extension
        base_filename = os.path.splitext(request.filename)[0]
        pattern = f"{base_filename}*"
        matching_files = glob.glob(pattern)
        
        files_data = []
        for file_path in matching_files:
            if os.path.isfile(file_path):
                with open(file_path, 'rb') as f:
                    file_content = f.read()
                encoded_content = base64.b64encode(file_content).decode('utf-8')
                files_data.append(FileData(
                    filename=os.path.basename(file_path),
                    content=encoded_content
                ))
                # Clean up the file after reading
                os.remove(file_path)
        
        if not files_data:
            response = RenderResponse(
                success=False,
                message="No files were generated matching the specified filename pattern"
            )
            return JSONResponse(
                content=response.dict(),
                status_code=status.HTTP_202_ACCEPTED
            )
        
        response = RenderResponse(
            success=True,
            files=files_data,
            message=f"Successfully generated {len(files_data)} file(s)"
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_200_OK
        )
            
    except SyntaxError as e:
        error_details = f"Syntax error in code: {str(e)}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )
    except NameError as e:
        error_details = f"Name error in code: {str(e)}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )
    except Exception as e:
        # Log the full traceback for debugging
        error_details = f"Execution error: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_details)
        response = RenderResponse(
            success=False,
            message=error_details
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_202_ACCEPTED
        )


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

    API contract matches the STL rendering service exactly so the backend
    can switch between providers transparently.
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