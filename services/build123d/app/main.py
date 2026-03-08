from typing import Union, List, Optional
import ast
import os
import sys
import tempfile
import shutil
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
    skip_root_part: bool = False

class LintWarning(BaseModel):
    rule: str
    message: str
    line: int
    severity: str  # "error" or "warning"

class ValidateResponse(BaseModel):
    valid: bool
    errors: List[str] = []
    warnings: List[LintWarning] = []

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

class ProjectFile(BaseModel):
    path: str      # e.g., "main.py", "components/gear.py"
    content: str   # file content (plain text, not base64)

class RenderProjectRequest(BaseModel):
    files: List[ProjectFile]
    filename: str = "output.step"  # base filename for outputs

class ValidateProjectResponse(BaseModel):
    valid: bool
    errors: List[str] = []
    warnings: List[LintWarning] = []
    file_errors: dict = {}   # { "components/gear.py": ["error msg"] }

# ── Lint rules ────────────────────────────────────────────────────────

# Forbidden function/class calls
_FORBIDDEN_IMPORTS = frozenset({"sys", "matplotlib", "ocp_vscode"})
_FORBIDDEN_CALLS = frozenset({"show", "show_object", "input", "print"})
_EXPORT_CALLS = frozenset({"export_step", "export_stl"})


def _get_call_name(node: ast.Call) -> Optional[str]:
    """Extract simple function/class name from a Call node."""
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return None


def lint_code(tree: ast.Module, code: str) -> List[LintWarning]:
    """Run AST-based lint rules on parsed code. Returns a list of warnings."""
    warnings: List[LintWarning] = []

    for node in ast.walk(tree):
        # ── Call-based rules ──
        if isinstance(node, ast.Call):
            name = _get_call_name(node)
            if not name:
                continue

            # no_box_centered: Box() with centered kwarg
            if name == "Box":
                for kw in node.keywords:
                    if kw.arg == "centered":
                        warnings.append(LintWarning(
                            rule="no_box_centered",
                            message="Box() does not accept a 'centered' keyword. In Build123d, Box is always centered by default. Remove the 'centered' argument.",
                            line=node.lineno,
                            severity="error",
                        ))
                        break

            # no_shell_class: Shell() call
            if name == "Shell":
                warnings.append(LintWarning(
                    rule="no_shell_class",
                    message="Shell() is not a Build123d class. Use offset() for hollowing a solid instead.",
                    line=node.lineno,
                    severity="error",
                ))

            # locations_bare_int: Locations() with bare int/float args
            if name == "Locations":
                for arg in node.args:
                    if isinstance(arg, (ast.Constant, ast.UnaryOp)):
                        warnings.append(LintWarning(
                            rule="locations_bare_int",
                            message="Locations() expects tuple arguments like (x, y), not bare numbers. Wrap each position in a tuple.",
                            line=node.lineno,
                            severity="error",
                        ))
                        break

            # no_export_calls: export_step(), export_stl(), Mesher()
            if name in _EXPORT_CALLS or name == "Mesher":
                warnings.append(LintWarning(
                    rule="no_export_calls",
                    message=f"{name}() should not be in your code. The execution template handles exports automatically.",
                    line=node.lineno,
                    severity="warning",
                ))

            # no_show_calls: show(), show_object()
            if name in ("show", "show_object"):
                warnings.append(LintWarning(
                    rule="no_show_calls",
                    message=f"{name}() is not available in the rendering environment. Remove this call.",
                    line=node.lineno,
                    severity="error",
                ))

            # no_interactive: input(), print()
            if name in ("input", "print"):
                warnings.append(LintWarning(
                    rule="no_interactive",
                    message=f"{name}() is not available in the rendering environment. Remove this call.",
                    line=node.lineno,
                    severity="warning",
                ))

        # ── Import-based rules ──
        if isinstance(node, ast.Import):
            for alias in node.names:
                mod = alias.name.split(".")[0]
                if mod in _FORBIDDEN_IMPORTS:
                    warnings.append(LintWarning(
                        rule="no_forbidden_imports",
                        message=f"import {alias.name} is not allowed in the rendering environment.",
                        line=node.lineno,
                        severity="error",
                    ))

        if isinstance(node, ast.ImportFrom):
            if node.module:
                mod = node.module.split(".")[0]
                if mod in _FORBIDDEN_IMPORTS:
                    warnings.append(LintWarning(
                        rule="no_forbidden_imports",
                        message=f"from {node.module} import ... is not allowed in the rendering environment.",
                        line=node.lineno,
                        severity="error",
                    ))
                # no_build123d_import: from build123d import *
                if node.module == "build123d":
                    warnings.append(LintWarning(
                        rule="no_build123d_import",
                        message="Do not include 'from build123d import *'. The execution template provides this import automatically.",
                        line=node.lineno,
                        severity="warning",
                    ))

    # ── Structural rules (require walking context-manager nesting) ──
    _check_missing_make_face(tree, warnings)
    _check_fillet_before_boolean(tree, warnings)

    return warnings


def _check_missing_make_face(tree: ast.Module, warnings: List[LintWarning]) -> None:
    """Warn if BuildLine inside BuildSketch is not followed by make_face() before extrude()."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.With):
            continue
        # Check if this is a BuildSketch context
        for item in node.items:
            call = item.context_expr
            if isinstance(call, ast.Call) and _get_call_name(call) == "BuildSketch":
                # Look for BuildLine inside, and check for make_face
                has_build_line = False
                has_make_face = False
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        cname = _get_call_name(child)
                        if cname == "BuildLine":
                            has_build_line = True
                        if cname == "make_face":
                            has_make_face = True
                if has_build_line and not has_make_face:
                    warnings.append(LintWarning(
                        rule="missing_make_face",
                        message="BuildLine inside BuildSketch requires make_face() to convert the wire into a face before extrude(). Add make_face() after the BuildLine block.",
                        line=node.lineno,
                        severity="warning",
                    ))


def _check_fillet_before_boolean(tree: ast.Module, warnings: List[LintWarning]) -> None:
    """Warn if fillet()/chamfer() appears before boolean ops (mode=Mode.SUBTRACT)."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.With):
            continue
        # Check BuildPart contexts
        for item in node.items:
            call = item.context_expr
            if isinstance(call, ast.Call) and _get_call_name(call) == "BuildPart":
                _scan_fillet_then_boolean(node.body, warnings)


def _scan_fillet_then_boolean(stmts: List[ast.stmt], warnings: List[LintWarning]) -> None:
    """Walk a statement list looking for fillet/chamfer followed by boolean subtract."""
    fillet_line: Optional[int] = None
    for stmt in stmts:
        # Walk all expressions in each statement
        for child in ast.walk(stmt):
            if isinstance(child, ast.Call):
                cname = _get_call_name(child)
                if cname in ("fillet", "chamfer") and fillet_line is None:
                    fillet_line = child.lineno
                # Detect mode=Mode.SUBTRACT
                if fillet_line is not None and cname is not None:
                    for kw in child.keywords:
                        if kw.arg == "mode" and isinstance(kw.value, ast.Attribute):
                            if kw.value.attr == "SUBTRACT":
                                warnings.append(LintWarning(
                                    rule="fillet_before_boolean",
                                    message=f"fillet()/chamfer() at line {fillet_line} appears before a boolean subtract at line {child.lineno}. Apply fillets/chamfers AFTER all boolean operations to avoid topological errors.",
                                    line=fillet_line,
                                    severity="warning",
                                ))
                                fillet_line = None  # Only warn once per fillet
                                break
        # Also recurse into nested with blocks
        if isinstance(stmt, ast.With):
            _scan_fillet_then_boolean(stmt.body, warnings)


@app.post("/validate/")
def validate_code(request: ValidateRequest):
    """Lightweight AST-level validation + lint without executing the code."""
    errors = []
    try:
        tree = ast.parse(request.code)
    except SyntaxError as e:
        return ValidateResponse(valid=False, errors=[f"Syntax error: {e}"])

    # Check that code assigns to root_part (can be skipped for reference/knowledge validation)
    if not request.skip_root_part:
        has_root_part = any(
            isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "root_part" for t in node.targets)
            for node in ast.walk(tree)
        )
        if not has_root_part:
            errors.append(
                "Missing 'root_part' assignment — code must assign the final solid to root_part"
            )

    # Run lint rules
    lint_warnings = lint_code(tree, request.code)

    # Lint errors also cause validation failure
    for w in lint_warnings:
        if w.severity == "error":
            errors.append(f"[{w.rule}] {w.message} (line {w.line})")

    return ValidateResponse(
        valid=len(errors) == 0,
        errors=errors,
        warnings=lint_warnings,
    )

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

# ── Multi-file project endpoints ──────────────────────────────────────

@app.post("/render-project/")
def render_project(request: RenderProjectRequest):
    """Render a multi-file project. Executes main.py as the entry point."""
    tmpdir = tempfile.mkdtemp()
    original_cwd = os.getcwd()
    try:
        # Find main.py in the file list
        main_file = None
        for f in request.files:
            if f.path == "main.py":
                main_file = f
                break

        if main_file is None:
            return JSONResponse(
                content=RenderResponse(
                    success=False,
                    message="Project must contain a 'main.py' file as the entry point."
                ).dict(),
                status_code=status.HTTP_202_ACCEPTED,
            )

        # Write all files to the temp directory, maintaining directory structure
        for f in request.files:
            file_path = os.path.join(tmpdir, f.path)
            file_dir = os.path.dirname(file_path)
            os.makedirs(file_dir, exist_ok=True)
            with open(file_path, "w", encoding="utf-8") as fh:
                fh.write(f.content)

        # Add tmpdir to sys.path so imports between project files work
        sys.path.insert(0, tmpdir)

        # Change to tmpdir so relative file outputs land there
        os.chdir(tmpdir)

        # Execute main.py content directly (same pattern as /render/)
        logger.info("Executing project main.py from tmpdir: %s", tmpdir)
        exec(main_file.content, {})

        # Glob for output files (same pattern as /render/)
        base_filename = os.path.splitext(request.filename)[0]
        pattern = os.path.join(tmpdir, f"{base_filename}*")
        matching_files = glob.glob(pattern)

        files_data = []
        for fp in matching_files:
            if os.path.isfile(fp):
                with open(fp, "rb") as fh:
                    file_content = fh.read()
                encoded_content = base64.b64encode(file_content).decode("utf-8")
                files_data.append(FileData(
                    filename=os.path.basename(fp),
                    content=encoded_content,
                ))

        if not files_data:
            return JSONResponse(
                content=RenderResponse(
                    success=False,
                    message="No files were generated matching the specified filename pattern",
                ).dict(),
                status_code=status.HTTP_202_ACCEPTED,
            )

        response = RenderResponse(
            success=True,
            files=files_data,
            message=f"Successfully generated {len(files_data)} file(s)",
        )
        return JSONResponse(
            content=response.dict(),
            status_code=status.HTTP_200_OK,
        )

    except SyntaxError as e:
        error_details = f"Syntax error in project code: {str(e)}"
        logger.error(error_details)
        return JSONResponse(
            content=RenderResponse(success=False, message=error_details).dict(),
            status_code=status.HTTP_202_ACCEPTED,
        )
    except NameError as e:
        error_details = f"Name error in project code: {str(e)}"
        logger.error(error_details)
        return JSONResponse(
            content=RenderResponse(success=False, message=error_details).dict(),
            status_code=status.HTTP_202_ACCEPTED,
        )
    except Exception as e:
        error_details = f"Execution error: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_details)
        return JSONResponse(
            content=RenderResponse(success=False, message=error_details).dict(),
            status_code=status.HTTP_202_ACCEPTED,
        )
    finally:
        # Clean up: restore cwd, remove tmpdir from sys.path, delete temp files
        os.chdir(original_cwd)
        if tmpdir in sys.path:
            sys.path.remove(tmpdir)
        shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/validate-project/")
def validate_project(request: RenderProjectRequest):
    """Validate a multi-file project without executing it."""
    errors: List[str] = []
    all_warnings: List[LintWarning] = []
    file_errors: dict = {}

    # Check that main.py exists
    main_file = None
    for f in request.files:
        if f.path == "main.py":
            main_file = f
            break

    if main_file is None:
        errors.append("Project must contain a 'main.py' file as the entry point.")
        return ValidateProjectResponse(
            valid=False,
            errors=errors,
            file_errors=file_errors,
        )

    # Parse each file and collect syntax errors per file
    for f in request.files:
        try:
            ast.parse(f.content)
        except SyntaxError as e:
            msg = f"Syntax error: {e}"
            if f.path not in file_errors:
                file_errors[f.path] = []
            file_errors[f.path].append(msg)
            errors.append(f"[{f.path}] {msg}")

    # Run lint rules on main.py (the entry point)
    if main_file.path not in file_errors:
        try:
            tree = ast.parse(main_file.content)

            # Check that main.py assigns to root_part
            has_root_part = any(
                isinstance(node, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == "root_part" for t in node.targets)
                for node in ast.walk(tree)
            )
            if not has_root_part:
                errors.append(
                    "Missing 'root_part' assignment in main.py — code must assign the final solid to root_part"
                )

            # Lint main.py
            lint_warnings = lint_code(tree, main_file.content)
            all_warnings.extend(lint_warnings)

            # Lint errors also cause validation failure
            for w in lint_warnings:
                if w.severity == "error":
                    errors.append(f"[{w.rule}] {w.message} (line {w.line})")

        except SyntaxError:
            pass  # Already caught above

    return ValidateProjectResponse(
        valid=len(errors) == 0,
        errors=errors,
        warnings=all_warnings,
        file_errors=file_errors,
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
