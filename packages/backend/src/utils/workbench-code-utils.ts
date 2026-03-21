/**
 * Workbench Code Utilities
 *
 * Template wrapping, stripping, and file-type helpers extracted from workbench-codegen.
 */

import type { RenderedFile } from "../services/rendering.service.js";

/**
 * Code template that wraps LLM-generated modeling code.
 * The LLM produces only the Build123d modeling code ending with `root_part = ...`.
 * This template adds the import and all export calls around it.
 */
export const CODE_TEMPLATE = `from build123d import *
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
from bd_warehouse.sprocket import Sprocket
###CODE###
export_step(root_part, "###FILENAME###.step")
exporter = Mesher()
exporter.add_shape(root_part)
exporter.write("###FILENAME###.3mf")
exporter.write("###FILENAME###.stl")
`;

/**
 * Wrap raw LLM-generated modeling code in the execution template.
 * The raw code is stored in the DB for training data; the wrapped version
 * is sent to Build123d for rendering.
 */
export function wrapInTemplate(rawCode: string, baseFileName: string): string {
  return CODE_TEMPLATE
    .replace("###CODE###", rawCode)
    .replaceAll("###FILENAME###", baseFileName);
}

/**
 * Strip template boilerplate that the LLM might include despite instructions.
 * We want to store only the modeling code (no imports, no exports).
 */
export function stripTemplateBoilerplate(code: string): string {
  return code
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "from build123d import *") return false;
      if (trimmed === "import math") return false;
      if (trimmed.startsWith("export_step(")) return false;
      if (trimmed.startsWith("exporter = Mesher(")) return false;
      if (trimmed.startsWith("exporter.add_shape(")) return false;
      if (trimmed.startsWith("exporter.write(")) return false;
      return true;
    })
    .join("\n")
    .trim();
}

export function findFileByExtension(files: RenderedFile[], ext: string): RenderedFile | undefined {
  return files.find((f) => f.filename.toLowerCase().endsWith(ext));
}

export function mapExtension(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  if (lower.endsWith(".3mf")) return "3mf";
  if (lower.endsWith(".b123d")) return "b123d";
  return "bin";
}
