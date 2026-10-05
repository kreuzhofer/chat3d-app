"""The CAD stack the service runs: released build123d 0.13 plus the two
part libraries the codegen prompts teach (#135).

Renders go through POST /render/ with the backend's execution template
header (packages/backend/src/utils/workbench-code-utils.ts), so a library
that imports but cannot build a part still fails here.
"""
import base64
import os
import sys
from importlib.metadata import version

sys.path.insert(0, os.path.dirname(__file__))
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

# The backend's CODE_TEMPLATE, verbatim: its import block and its exports.
TEMPLATE_HEADER = """from build123d import *
import math
from bd_warehouse.thread import IsoThread, AcmeThread, MetricTrapezoidalThread
from bd_warehouse.fastener import (
    CounterSunkScrew, HexHeadScrew, SocketHeadCapScrew, SetScrew,
    PanHeadScrew, ButtonHeadScrew,
    HexNut, HexNutWithFlange, SquareNut, DomedCapNut,
    Washer, PlainWasher, ChamferedWasher,
)
from bd_warehouse.bearing import SingleRowDeepGrooveBallBearing
from bd_warehouse.gear import SpurGear
from bd_warehouse.pipe import Pipe, PipeSection
from gridfinity_build123d import (
    Bin, Base, BaseEqual,
    BasePlate, BasePlateEqual,
    BasePlateBlockFrame, BasePlateBlockFull, BasePlateBlockSkeleton,
    Compartment, Compartments, CompartmentsEqual,
    StackingLip, Label, Scoop, Weighted,
    MagnetHole, ScrewHole, ScrewHoleCounterbore, ScrewHoleCountersink,
    HoleFeature,
    TopCorners, TopMiddle, BottomCorners, BottomMiddle, BottomSides,
)
"""

TEMPLATE_FOOTER = """
export_step(root_part, "{name}.step")
exporter = Mesher()
exporter.add_shape(root_part.solids())
exporter.write("{name}.3mf")
exporter.write("{name}.stl")
"""


def _render(name: str, model_code: str) -> dict:
    code = TEMPLATE_HEADER + model_code + TEMPLATE_FOOTER.format(name=name)
    res = client.post("/render/", json={"code": code, "filename": f"{name}.step"})
    return res.json()


def _assert_rendered(body: dict, name: str) -> None:
    assert body["success"], body["message"]
    files = {f["filename"]: f for f in body["files"]}
    assert set(files) == {f"{name}.step", f"{name}.stl", f"{name}.3mf"}
    for f in files.values():
        assert len(base64.b64decode(f["content"])) > 0


def test_runs_released_build123d_013():
    # A released version, not a git dev build ("0.10.1.dev310+ge8cae0660").
    v = version("build123d")
    assert v.startswith("0.13."), v
    assert "dev" not in v and "+" not in v, v


def test_runs_ocp_8():
    assert version("cadquery-ocp-novtk").startswith("8."), version("cadquery-ocp-novtk")


def test_runs_bd_warehouse_03():
    # 0.3.1.dev from the pinned commit until 0.3.1 is released
    assert version("bd_warehouse").startswith("0.3."), version("bd_warehouse")


def test_template_imports_succeed():
    exec(TEMPLATE_HEADER, {})


def test_bd_warehouse_gear_renders():
    body = _render("libtest_gear", "root_part = SpurGear(module=2, tooth_count=20, pressure_angle=20, thickness=10)\n")
    _assert_rendered(body, "libtest_gear")


def test_bd_warehouse_fastener_renders():
    body = _render("libtest_screw", 'root_part = SocketHeadCapScrew(size="M3-0.5", length=10, simple=True)\n')
    _assert_rendered(body, "libtest_screw")


def test_bd_warehouse_threaded_fastener_renders():
    # A labelled thread of several touching solids: meshed as one object it is
    # not manifold and lib3mf rejects it, so the template meshes per solid.
    body = _render("libtest_nut", 'root_part = HexNutWithFlange(size="M10-1.5", fastener_type="din1665", simple=False)\n')
    _assert_rendered(body, "libtest_nut")


def test_bd_warehouse_pipe_renders():
    # "steel" is a pipe-table material bd_materials does not know (patched).
    body = _render("libtest_pipe", 'root_part = Pipe(nps="1", material="steel", identifier="40", path=Line((0, 0, 0), (0, 0, 100)))\n')
    _assert_rendered(body, "libtest_pipe")


def test_gridfinity_bin_renders():
    body = _render("libtest_bin", "root_part = Bin(Base(), height_in_units=3, compartments=CompartmentsEqual())\n")
    _assert_rendered(body, "libtest_bin")


def test_gridfinity_baseplate_renders():
    # BasePlate fillets the grid corners at exactly the corner radius, which
    # OCCT >= 7.9 rejects unless patched (see patches/patch_libraries.py).
    body = _render("libtest_baseplate", "root_part = BasePlateEqual(size_x=2, size_y=2)\n")
    _assert_rendered(body, "libtest_baseplate")
