# #94 — the judge training export, first run (2026-09-15)

`pool94.ts` prints the manifest without images (`DB_HOST=localhost npx tsx prototypes/94-judge-export/pool94.ts`);
`verify94.py <tarball>` opens a tarball the way a VLM-SFT loader would (JSONL rows, image parts resolved
inside the archive, PNG magic, held-out exclusion, one checklist answer per asked item).

First tarball from `GET /api/admin/workbench/export/judge-sft.tar.gz` on the deployed backend: 39.5 MB in 1.3 s.

| | |
|---|---|
| instrument | `production@4892d8d1b160` |
| samples (examples) | 152 |
| items | 228 — 55 adjudicated, 173 agreed; 181 pass, 47 fail |
| cap | 3 passes per fail: 47 fails → 141 of 966 agreed passes kept (seed 94) |
| images | 1,216 PNGs, all valid |
| held out | 359 example ids: the 125 of `7337a398`, #63's sample `09411bc4`, #87's sample `dadf32f4` |
| sittings used | #91 seed 91 (409 items), #91 seed 92 (438), Kimi K3 vs qwen (247) |
| sittings skipped | #57 and #63 (instrument `22e0f10b0505`, not current); #85 and #87 contribute nothing (every row held out) |
