"""Tests for the lint rules integrated into /validate/."""
import ast
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from main import (
    lint_code, LintWarning, validate_code, ValidateRequest,
    RenderProjectRequest, ProjectFile, ValidateProjectResponse,
    validate_project, render_project,
)
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def _lint(code: str) -> list[LintWarning]:
    tree = ast.parse(code)
    return lint_code(tree, code)


def _rules(warnings: list[LintWarning]) -> set[str]:
    return {w.rule for w in warnings}


# ── no_box_centered ──────────────────────────────────────────────────

def test_box_centered_flagged():
    code = 'Box(10, 10, 10, centered=True)'
    ws = _lint(code)
    assert "no_box_centered" in _rules(ws)
    assert ws[0].severity == "error"


def test_box_without_centered_ok():
    code = 'Box(10, 10, 10)'
    ws = _lint(code)
    assert "no_box_centered" not in _rules(ws)


# ── no_shell_class ───────────────────────────────────────────────────

def test_shell_class_flagged():
    code = 'Shell(thickness=2)'
    ws = _lint(code)
    assert "no_shell_class" in _rules(ws)
    assert any(w.severity == "error" for w in ws if w.rule == "no_shell_class")


def test_offset_ok():
    code = 'offset(amount=-2, openings=part.faces().sort_by(Axis.Z)[-1])'
    ws = _lint(code)
    assert "no_shell_class" not in _rules(ws)


# ── locations_bare_int ───────────────────────────────────────────────

def test_locations_bare_int_flagged():
    code = 'Locations(10, 20, 30)'
    ws = _lint(code)
    assert "locations_bare_int" in _rules(ws)


def test_locations_with_tuples_ok():
    code = 'Locations((10, 0), (20, 0))'
    ws = _lint(code)
    assert "locations_bare_int" not in _rules(ws)


# ── no_export_calls ──────────────────────────────────────────────────

def test_export_step_flagged():
    code = 'export_step(root_part, "out.step")'
    ws = _lint(code)
    assert "no_export_calls" in _rules(ws)
    assert any(w.severity == "warning" for w in ws if w.rule == "no_export_calls")


def test_mesher_flagged():
    code = 'exporter = Mesher()'
    ws = _lint(code)
    assert "no_export_calls" in _rules(ws)


# ── no_build123d_import ──────────────────────────────────────────────

def test_build123d_import_flagged():
    code = 'from build123d import *'
    ws = _lint(code)
    assert "no_build123d_import" in _rules(ws)
    assert any(w.severity == "warning" for w in ws if w.rule == "no_build123d_import")


# ── no_forbidden_imports ─────────────────────────────────────────────

def test_import_sys_flagged():
    code = 'import sys'
    ws = _lint(code)
    assert "no_forbidden_imports" in _rules(ws)
    assert any(w.severity == "error" for w in ws if w.rule == "no_forbidden_imports")


def test_from_matplotlib_flagged():
    code = 'from matplotlib import pyplot'
    ws = _lint(code)
    assert "no_forbidden_imports" in _rules(ws)


def test_import_math_ok():
    code = 'import math'
    ws = _lint(code)
    assert "no_forbidden_imports" not in _rules(ws)


# ── no_show_calls ────────────────────────────────────────────────────

def test_show_flagged():
    code = 'show(part)'
    ws = _lint(code)
    assert "no_show_calls" in _rules(ws)
    assert any(w.severity == "error" for w in ws if w.rule == "no_show_calls")


def test_show_object_flagged():
    code = 'show_object(part)'
    ws = _lint(code)
    assert "no_show_calls" in _rules(ws)


# ── no_interactive ───────────────────────────────────────────────────

def test_input_flagged():
    code = 'x = input("Enter value")'
    ws = _lint(code)
    assert "no_interactive" in _rules(ws)


def test_print_flagged():
    code = 'print("hello")'
    ws = _lint(code)
    assert "no_interactive" in _rules(ws)
    assert any(w.severity == "warning" for w in ws if w.rule == "no_interactive")


# ── missing_make_face ────────────────────────────────────────────────

def test_missing_make_face_flagged():
    code = '''
with BuildSketch() as sk:
    with BuildLine() as line:
        Line((0, 0), (10, 0))
        Line((10, 0), (10, 10))
        Line((10, 10), (0, 0))
'''
    ws = _lint(code)
    assert "missing_make_face" in _rules(ws)


def test_make_face_present_ok():
    code = '''
with BuildSketch() as sk:
    with BuildLine() as line:
        Line((0, 0), (10, 0))
        Line((10, 0), (10, 10))
        Line((10, 10), (0, 0))
    make_face()
'''
    ws = _lint(code)
    assert "missing_make_face" not in _rules(ws)


# ── fillet_before_boolean ────────────────────────────────────────────

def test_fillet_before_subtract_flagged():
    code = '''
with BuildPart() as part:
    Box(20, 20, 20)
    fillet(part.edges(), radius=2)
    with Locations((0, 0, 10)):
        Cylinder(5, 20, mode=Mode.SUBTRACT)
'''
    ws = _lint(code)
    assert "fillet_before_boolean" in _rules(ws)


def test_fillet_after_subtract_ok():
    code = '''
with BuildPart() as part:
    Box(20, 20, 20)
    with Locations((0, 0, 10)):
        Cylinder(5, 20, mode=Mode.SUBTRACT)
    fillet(part.edges(), radius=2)
'''
    ws = _lint(code)
    assert "fillet_before_boolean" not in _rules(ws)


# ── Validate endpoint integration ────────────────────────────────────

def test_validate_lint_errors_fail_validation():
    """Lint errors with severity='error' should cause valid=False."""
    req = ValidateRequest(code='root_part = Box(10, 10, 10, centered=True)')
    resp = validate_code(req)
    assert resp.valid is False
    assert any("no_box_centered" in e for e in resp.errors)
    assert len(resp.warnings) > 0


def test_validate_lint_warnings_pass_validation():
    """Lint warnings with severity='warning' should NOT fail validation."""
    code = '''from build123d import *
root_part = Box(10, 10, 10)
'''
    req = ValidateRequest(code=code)
    resp = validate_code(req)
    # The code has root_part and valid syntax; build123d import is just a warning
    assert resp.valid is True
    assert any(w.rule == "no_build123d_import" for w in resp.warnings)


def test_validate_valid_code():
    """Clean code passes with no errors or warnings."""
    code = '''
with BuildPart() as part:
    Box(20, 20, 20)
root_part = part.part
'''
    req = ValidateRequest(code=code)
    resp = validate_code(req)
    assert resp.valid is True
    assert len(resp.errors) == 0
    assert len(resp.warnings) == 0


# ── Project endpoint tests ────────────────────────────────────────────

def test_render_project_single_file():
    """Render a single-file project with main.py."""
    code = '''
import math
result = math.sqrt(16)
# Write a simple output file to verify execution
with open("output.txt", "w") as f:
    f.write(f"result={result}")
'''
    response = client.post("/render-project/", json={
        "files": [{"path": "main.py", "content": code}],
        "filename": "output.txt",
    })
    data = response.json()
    assert data["success"] is True
    assert len(data["files"]) >= 1
    assert any(f["filename"] == "output.txt" for f in data["files"])


def test_render_project_multi_file():
    """Render a project with main.py importing from components/helper.py."""
    helper_code = '''
def compute_value():
    return 42
'''
    main_code = '''
from components.helper import compute_value
val = compute_value()
with open("output.txt", "w") as f:
    f.write(f"value={val}")
'''
    response = client.post("/render-project/", json={
        "files": [
            {"path": "main.py", "content": main_code},
            {"path": "components/__init__.py", "content": ""},
            {"path": "components/helper.py", "content": helper_code},
        ],
        "filename": "output.txt",
    })
    data = response.json()
    assert data["success"] is True
    assert len(data["files"]) >= 1
    # Verify the content is correct
    import base64
    for fd in data["files"]:
        if fd["filename"] == "output.txt":
            content = base64.b64decode(fd["content"]).decode("utf-8")
            assert content == "value=42"
            break
    else:
        assert False, "output.txt not found in response files"


def test_validate_project_missing_main():
    """Validate a project without main.py — should fail."""
    response = client.post("/validate-project/", json={
        "files": [
            {"path": "helper.py", "content": "x = 1"},
        ],
        "filename": "output.step",
    })
    data = response.json()
    assert data["valid"] is False
    assert any("main.py" in e for e in data["errors"])
