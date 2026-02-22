/**
 * Build123d API Reference Data
 *
 * Curated subset of Build123d classes, functions, and usage patterns
 * included in the codegen system prompt to reduce LLM hallucination.
 *
 * Requirements: 7.1, 7.2, 7.4
 */

export interface Build123dApiEntry {
  className: string;
  signature: string;
  description: string;
  category:
    | "primitive"
    | "operation"
    | "boolean"
    | "fillet-chamfer"
    | "sketch"
    | "other";
}

export interface Build123dExampleSnippet {
  operation: string; // "extrude" | "revolve" | "boolean" | "loft"
  description: string;
  code: string;
}

export const API_ENTRIES: Build123dApiEntry[] = [
  // Primitives
  {
    className: "Box",
    signature: "Box(length: float, width: float, height: float, ...)",
    description: "Creates a rectangular box (cuboid) centered at the origin.",
    category: "primitive",
  },
  {
    className: "Cylinder",
    signature:
      "Cylinder(radius: float, height: float, arc_size: float = 360, ...)",
    description:
      "Creates a cylinder centered at the origin. Optional arc_size for partial cylinders.",
    category: "primitive",
  },
  {
    className: "Sphere",
    signature: "Sphere(radius: float, arc_size1: float = -90, arc_size2: float = 90, arc_size3: float = 360, ...)",
    description: "Creates a sphere centered at the origin.",
    category: "primitive",
  },
  {
    className: "Cone",
    signature:
      "Cone(bottom_radius: float, top_radius: float, height: float, arc_size: float = 360, ...)",
    description:
      "Creates a cone or truncated cone. Set top_radius=0 for a pointed cone.",
    category: "primitive",
  },
  {
    className: "Torus",
    signature:
      "Torus(major_radius: float, minor_radius: float, ...)",
    description:
      "Creates a torus (donut shape) centered at the origin.",
    category: "primitive",
  },
  // Operations
  {
    className: "Extrude",
    signature: "extrude(to_extrude: Face | Sketch, amount: float, ...)",
    description:
      "Extrudes a 2D face or sketch along its normal by the given amount.",
    category: "operation",
  },
  {
    className: "Revolve",
    signature:
      "revolve(to_revolve: Face | Sketch, axis: Axis, revolution_arc: float = 360, ...)",
    description:
      "Revolves a 2D face or sketch around an axis to create a solid of revolution.",
    category: "operation",
  },
  {
    className: "Loft",
    signature: "loft(sections: list[Face | Sketch], ruled: bool = False, ...)",
    description:
      "Creates a solid by lofting between two or more cross-section profiles.",
    category: "operation",
  },
  {
    className: "Sweep",
    signature: "sweep(section: Face | Sketch, path: Edge | Wire, ...)",
    description:
      "Sweeps a 2D profile along a path to create a solid.",
    category: "operation",
  },
  // Boolean operations
  {
    className: "BooleanOperation (fuse/cut/intersect)",
    signature: "fuse(*args), cut(*args), intersect(*args)",
    description:
      "Boolean operations: fuse (union) combines solids, cut (difference) subtracts, intersect keeps the common volume. Used within BuildPart context via add() and operators.",
    category: "boolean",
  },
  // Fillet and Chamfer
  {
    className: "Fillet",
    signature: "fillet(objects: Edge | list[Edge], radius: float)",
    description:
      "Rounds edges of a solid with the specified radius. Select edges via .edges().",
    category: "fillet-chamfer",
  },
  {
    className: "Chamfer",
    signature: "chamfer(objects: Edge | list[Edge], length: float, length2: float | None = None)",
    description:
      "Bevels edges of a solid. Symmetric if one length, asymmetric if two lengths provided.",
    category: "fillet-chamfer",
  },
  // Sketch primitives
  {
    className: "Circle (Sketch)",
    signature: "Circle(radius: float, ...)",
    description: "Creates a circular sketch face for extrusion or revolution.",
    category: "sketch",
  },
  {
    className: "Rectangle (Sketch)",
    signature: "Rectangle(width: float, height: float, ...)",
    description: "Creates a rectangular sketch face.",
    category: "sketch",
  },
  {
    className: "Polygon (Sketch)",
    signature: "RegularPolygon(radius: float, side_count: int, ...)",
    description: "Creates a regular polygon sketch face.",
    category: "sketch",
  },
  // Other utilities
  {
    className: "BuildPart",
    signature: "with BuildPart() as part: ...",
    description:
      "Context manager for building 3D parts. All geometry operations happen inside this context.",
    category: "other",
  },
  {
    className: "BuildSketch",
    signature: "with BuildSketch() as sketch: ...",
    description:
      "Context manager for building 2D sketches. Used inside BuildPart for creating profiles to extrude/revolve.",
    category: "other",
  },
  {
    className: "Locations / GridLocations",
    signature: "Locations(*pts), GridLocations(x_spacing, y_spacing, x_count, y_count)",
    description:
      "Position context managers for placing geometry at specific locations or in grid patterns.",
    category: "other",
  },
  {
    className: "export_step",
    signature: "export_step(part: Part, file_path: str)",
    description: "Exports a Part to STEP file format.",
    category: "other",
  },
  {
    className: "export_stl",
    signature: "export_stl(part: Part, file_path: str)",
    description: "Exports a Part to STL file format.",
    category: "other",
  },
];

export const EXAMPLE_SNIPPETS: Build123dExampleSnippet[] = [
  {
    operation: "extrude",
    description: "Extrude a rectangular sketch into a 3D box with rounded edges",
    code: `from build123d import *

with BuildPart() as part:
    with BuildSketch() as sketch:
        Rectangle(50, 30)
    extrude(amount=20)
    fillet(part.edges().filter_by(Axis.Z), radius=3)

export_step(part.part, "extruded_box.step")`,
  },
  {
    operation: "revolve",
    description: "Revolve an L-shaped profile around the Y-axis to create a bowl",
    code: `from build123d import *

with BuildPart() as part:
    with BuildSketch(Plane.XZ) as sketch:
        with BuildLine():
            l1 = Line((0, 0), (30, 0))
            l2 = Line((30, 0), (30, 5))
            l3 = Line((30, 5), (5, 5))
            l4 = Line((5, 5), (5, 40))
            l5 = Line((5, 40), (0, 40))
            Line((0, 40), (0, 0))
        make_face()
    revolve(axis=Axis.Y)

export_step(part.part, "bowl.step")`,
  },
  {
    operation: "boolean",
    description: "Boolean union and difference: create a block with a cylindrical hole",
    code: `from build123d import *

with BuildPart() as part:
    Box(40, 40, 20)
    with Locations((0, 0, 0)):
        Cylinder(radius=10, height=20, mode=Mode.SUBTRACT)

export_step(part.part, "block_with_hole.step")`,
  },
  {
    operation: "loft",
    description: "Loft between a square base and a circular top",
    code: `from build123d import *

with BuildPart() as part:
    with BuildSketch(Plane.XY.offset(0)) as s1:
        Rectangle(40, 40)
    with BuildSketch(Plane.XY.offset(50)) as s2:
        Circle(15)
    loft()

export_step(part.part, "lofted_shape.step")`,
  },
];

/**
 * Returns the Build123d API reference data.
 *
 * This function returns fresh references each call, supporting hot-reload
 * scenarios where the module can be invalidated from the require cache
 * and re-imported to pick up changes (Req 7.4).
 */
export function getBuild123dReference(): {
  entries: Build123dApiEntry[];
  examples: Build123dExampleSnippet[];
} {
  return {
    entries: API_ENTRIES,
    examples: EXAMPLE_SNIPPETS,
  };
}
