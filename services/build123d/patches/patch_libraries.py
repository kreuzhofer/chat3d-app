"""Patch installed part libraries for build123d 0.13 / OCCT 8 (#135).

gridfinity_build123d (Ruudjhuu/gridfinity_build123d @ fc29ac6, its latest
commit) does not run on build123d >= 0.12:

- feature_locations.py imports ShapePredicate, which build123d removed. It is
  only used in an annotation, so Callable[[Shape], bool] replaces it.
- baseplate.py fillets the grid corners at exactly the corner arc radius,
  which OCCT >= 7.9 rejects ("3mf mesh is invalid" on every BasePlate). A
  radius 1e-4 mm smaller stays far below any print tolerance.
- utils.py builds a BaseSketchObject while a BuildPart is active (every Bin
  and Base). Since 0.12's BuildScope refactor that raises "BuildPart doesn't
  have a BaseSketchObject object". Its only caller adds the result to a
  BuildSketch itself, so it is built inside a private BuildSketch.
- Its helpers build nested builders inside the caller's builder, which 0.12
  places and publishes twice (floating lips, missing cuts):
  gridfinity_build123d_compat.py restores 0.10's semantics; it is copied
  into the package and imported from its __init__.

The first two are the edits proposed upstream in Ruudjhuu/gridfinity_build123d#168.

bd_warehouse (gumyr/bd_warehouse @ eed2da1):

- pipe.py resolves the pipe's material through bd_materials, which has no
  "steel", "iron" or "pvc", the pipe table's own materials: every Pipe of
  them raises "unknown material". The table lookup uses the raw name; the
  resolved material only sets mass and appearance, so it is set only when
  bd_materials knows the name.

Every replacement must match exactly the expected number of times, so a
changed upstream fails the image build instead of shipping half-patched.
"""
import importlib.util
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).parent


def package_dir(name: str) -> pathlib.Path:
    # Located without importing: unpatched gridfinity fails at import time.
    return pathlib.Path(importlib.util.find_spec(name).origin).parent


# package -> file -> [(old, new, expected count)]
EDITS = {
    "gridfinity_build123d": {
        "feature_locations.py": [
            ("    ShapePredicate,\n", "    Shape,\n", 1),
            ("    from collections.abc import Iterator\n",
             "    from collections.abc import Callable, Iterator\n", 1),
            ("edge_filter: ShapePredicate | Axis",
             "edge_filter: Callable[[Shape], bool] | Axis", 1),
        ],
        "utils.py": [
            ("        return BaseSketchObject(sketch.sketch, rotation, align, mode)\n",
             "        with BuildSketch(mode=Mode.PRIVATE):  # build123d >= 0.12 scopes\n"
             "            return BaseSketchObject(sketch.sketch, rotation, align, mode)\n", 1),
        ],
        "baseplate.py": [
            ("            _ = fillet(wires, 4)\n",
             "            _ = fillet(wires, 4 - 1e-4)  # OCCT >= 7.9 rejects r == corner arc\n", 1),
        ],
    },
    "bd_warehouse": {
        "pipe.py": [
            ("        self.material = resolve_material(material)\n",
             "        if material in material_names():  # pipe.csv's steel/iron/pvc are not\n"
             "            self.material = resolve_material(material)\n", 2),
            ("from bd_materials import resolve as resolve_material\n",
             "from bd_materials import material_names, resolve as resolve_material\n", 1),
        ],
    },
}

for package, files in EDITS.items():
    root = package_dir(package)
    for name, edits in files.items():
        path = root / name
        text = path.read_text(encoding="utf-8")
        for old, new, expected in edits:
            count = text.count(old)
            if count != expected:
                sys.exit(f"{path}: expected {expected} of {old!r}, found {count}")
            text = text.replace(old, new)
        path.write_text(text, encoding="utf-8")
        print(f"patched {path}")

gridfinity = package_dir("gridfinity_build123d")
shutil.copy(HERE / "gridfinity_build123d_compat.py", gridfinity / "_build123d_compat.py")
init = gridfinity / "__init__.py"
init_text = init.read_text(encoding="utf-8")
if "_build123d_compat" in init_text:
    sys.exit(f"{init}: compat import already present")
init.write_text(init_text + "\nfrom . import _build123d_compat  # build123d >= 0.12 builder scopes (#135)\n",
                encoding="utf-8")
print(f"installed {gridfinity / '_build123d_compat.py'}")
