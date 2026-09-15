// PROTOTYPE (#94): read the judge pool from the database and print the manifest counts, no images.
import { buildJudgeSftExport } from "../../src/services/training-export/judge-sft.exporter.js";
const built = await buildJudgeSftExport();
const { samples, ...manifest } = built.manifest;
console.log(JSON.stringify({ ...manifest, sampleCount: samples.length, jsonlBytes: built.jsonl.length, images: built.images.length, inlineImages: built.images.filter((i) => i.inline).length }, null, 2));
const first = built.jsonl.split("\n")[0];
console.log(first.slice(0, 1500));
process.exit(0);
