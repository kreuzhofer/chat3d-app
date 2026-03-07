from typing import Union, List, Optional
import ast
import os
import traceback
import logging
import base64
import glob
import multiprocessing
from http.server import HTTPServer, BaseHTTPRequestHandler

from fastapi import FastAPI, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Lightweight health check server (separate PROCESS, port 8080) ────
# The main uvicorn worker (port 80) blocks during exec() renders, and
# Python's GIL prevents even a separate thread from responding during
# CPU-bound OCCT kernel operations.
#
# A separate process has its own GIL, so it always responds.
# It's a daemon process — if the main process dies, this dies too,
# so Docker detects the failure and restarts the container.


class _HealthHandler(BaseHTTPRequestHandler):
    """Minimal handler — returns 200 OK."""

    def do_GET(self):
        body = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # Suppress request logs


def _run_health_server():
    """Run the health check HTTP server (blocking — runs in subprocess)."""
    server = HTTPServer(("0.0.0.0", 8080), _HealthHandler)
    server.serve_forever()


# Start health server in a daemon subprocess — has its own GIL
_health_proc = multiprocessing.Process(target=_run_health_server, daemon=True)
_health_proc.start()
logger.info("Health check server started (pid=%d) on port 8080", _health_proc.pid)

# ── FastAPI app ──────────────────────────────────────────────────────

app = FastAPI()

class ValidateRequest(BaseModel):
    code: str

class ValidateResponse(BaseModel):
    valid: bool
    errors: List[str] = []

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

class ExtractParamsRequest(BaseModel):
    code: str

class ExtractedParameter(BaseModel):
    name: str
    value: float
    line: int
    description: Optional[str] = None

class ExtractParamsResponse(BaseModel):
    parameters: List[ExtractedParameter] = []

@app.post("/validate/")
def validate_code(request: ValidateRequest):
    """Lightweight AST-level validation without executing the code."""
    errors = []
    try:
        tree = ast.parse(request.code)
    except SyntaxError as e:
        return ValidateResponse(valid=False, errors=[f"Syntax error: {e}"])

    # Check that code assigns to root_part
    has_root_part = any(
        isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "root_part" for t in node.targets)
        for node in ast.walk(tree)
    )
    if not has_root_part:
        errors.append(
            "Missing 'root_part' assignment — code must assign the final solid to root_part"
        )

    return ValidateResponse(valid=len(errors) == 0, errors=errors)

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

# ── Parameter extraction ─────────────────────────────────────────────

# Names that are clearly not user-configurable parameters
_EXCLUDED_NAMES = frozenset({"root_part", "part", "result", "sketch", "builder"})

@app.post("/extract-params/")
def extract_params(request: ExtractParamsRequest):
    """Parse Build123d code and return top-level numeric variable assignments."""
    try:
        tree = ast.parse(request.code)
    except SyntaxError as e:
        return JSONResponse(
            content={"parameters": [], "error": f"Syntax error: {e}"},
            status_code=status.HTTP_200_OK,
        )

    source_lines = request.code.splitlines()
    parameters: List[dict] = []

    for node in ast.iter_child_nodes(tree):
        # Only top-level simple assignments: name = <numeric literal>
        if not isinstance(node, ast.Assign):
            continue
        if len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue

        # Value must be a numeric constant (int or float) or negated numeric
        value_node = node.value
        negate = False
        if isinstance(value_node, ast.UnaryOp) and isinstance(value_node.op, ast.USub):
            value_node = value_node.operand
            negate = True

        if not isinstance(value_node, ast.Constant):
            continue
        if not isinstance(value_node.value, (int, float)):
            continue

        name = target.id
        if name in _EXCLUDED_NAMES or name.startswith("_"):
            continue

        raw_value = value_node.value
        if negate:
            raw_value = -raw_value

        # Extract inline comment from the source line
        description = None
        line_idx = node.lineno - 1  # ast uses 1-based line numbers
        if 0 <= line_idx < len(source_lines):
            line_text = source_lines[line_idx]
            hash_pos = line_text.find("#")
            if hash_pos >= 0:
                comment = line_text[hash_pos + 1:].strip()
                if comment:
                    description = comment

        parameters.append({
            "name": name,
            "value": float(raw_value),
            "line": node.lineno,
            "description": description,
        })

    return JSONResponse(
        content={"parameters": parameters},
        status_code=status.HTTP_200_OK,
    )
