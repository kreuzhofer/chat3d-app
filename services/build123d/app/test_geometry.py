"""The geometry block every render response carries (#137): the solid count
of root_part, the compound the execution template writes to STEP/STL, and its
bounding box. The count is measured where the geometry exists, so the
evaluation can check it against the spec's expected body count.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

# The backend's CODE_TEMPLATE exports (workbench-code-utils.ts).
FOOTER = """
export_step(root_part, "{name}.step")
exporter = Mesher()
exporter.add_shape(root_part.solids())
exporter.write("{name}.stl")
"""


def _render(name: str, model_code: str) -> dict:
    code = "from build123d import *\n" + model_code + FOOTER.format(name=name)
    res = client.post("/render/", json={"code": code, "filename": f"{name}.step"})
    body = res.json()
    assert body["success"], body["message"]
    return body


def _render_project(name: str, model_code: str) -> dict:
    main_py = "from build123d import *\n" + model_code + FOOTER.format(name=name)
    res = client.post("/render-project/", json={
        "files": [{"path": "main.py", "content": main_py}],
        "filename": name,
    })
    body = res.json()
    assert body["success"], body["message"]
    return body


def test_one_solid_counts_one_with_its_bounding_box():
    body = _render("geom_one", "root_part = Box(10, 20, 30)")
    geom = body["geometry"]
    assert geom["solid_count"] == 1
    assert geom["bbox"]["min"] == [-5.0, -10.0, -15.0]
    assert geom["bbox"]["max"] == [5.0, 10.0, 15.0]


def test_separate_solids_count_each():
    body = _render("geom_three", """
root_part = Compound([
    Pos(0, 0, 0) * Box(10, 10, 10),
    Pos(30, 0, 0) * Box(10, 10, 10),
    Pos(60, 0, 0) * Cylinder(5, 10),
])
""")
    geom = body["geometry"]
    assert geom["solid_count"] == 3
    assert geom["bbox"]["min"][0] == -5.0
    assert geom["bbox"]["max"][0] == 65.0


def test_fused_parts_count_once():
    body = _render("geom_fused", """
with BuildPart() as p:
    Box(20, 20, 10)
    with Locations((0, 0, 10)):
        Cylinder(5, 20)
root_part = p.part
""")
    assert body["geometry"]["solid_count"] == 1


def test_render_project_reports_the_block_too():
    body = _render_project("geom_proj", """
root_part = Compound([Box(10, 10, 10), Pos(20, 0, 0) * Box(10, 10, 10)])
""")
    assert body["geometry"]["solid_count"] == 2


def test_no_root_part_means_no_block():
    # Code that exports by itself, without root_part, has nothing to measure:
    # the render still succeeds and says so with a null block.
    code = """from build123d import *
part = Box(1, 1, 1)
export_step(part, "geom_none.step")
"""
    res = client.post("/render/", json={"code": code, "filename": "geom_none.step"})
    body = res.json()
    assert body["success"], body["message"]
    assert body["geometry"] is None


def test_a_failed_measurement_never_fails_the_render():
    # root_part that is not a shape: nothing to measure, the exported file stands.
    code = """from build123d import *
root_part = "not a shape"
export_step(Box(1, 1, 1), "geom_bad.step")
"""
    res = client.post("/render/", json={"code": code, "filename": "geom_bad.step"})
    body = res.json()
    assert body["success"], body["message"]
    assert body["geometry"] is None
