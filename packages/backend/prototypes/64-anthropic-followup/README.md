# PROTOTYPE — wayfinder #64: the reference's zoom follow-up guarded on the Anthropic path, the reference re-made

Throwaway record. Primary source for the resolution on [issue #64](https://github.com/kreuzhofer/chat3d-app/issues/64)
(map #45). The code change is on `wayfinder/61-qualification`: `resolveFollowUpOutput` in
`visual-eval-schema.service.ts` gives the zoom follow-up its `{pass, detail}` shape on Anthropic as well as on
vLLM (the SDK's Anthropic provider turns it into the API's native structured output, or a JSON tool where the model
lacks it), and the follow-up's `maxOutputTokens` goes 256 → 512 so the cap stops only a runaway reply. The main
evaluation call on Anthropic is untouched (still free text): the reference's first pass is not moved by this.

Run `6f6bb5c0` (experiment `32e2fb96`): Claude Sonnet 4.6 (Anthropic API, thinking off), the 125 copied by id,
`production@22e0f10b0505`, concurrency 3, 14:50–15:08 UTC.

- `screen-sonnet-remade-vs-444483ec.txt` — the re-made reference against the previous Sonnet run under the same id:
  first pass 88.8% identical, **1.6% hard flips (8)** — inside Sonnet's own floor, i.e. the fix moved nothing at first
  pass; after zoom 92.2% / 4.3%, either-uncertain 18.
- `screen-arm1-arm3-vs-sonnet-remade.txt` — **the qualification screen against the re-made reference** (PASS on the
  mechanical terms, as in #61).
- `disagreements-arm1-vs-sonnet.md` — **the sheet for #57**: 69 items on 40 examples (65 hard flips, 4 with the
  reference uncertain), arm 3 never differs from arm 1.
- `exp64.txt`, `run64-sonnet-ref.txt`, `start64.txt` — ids and start time.

## Readings

| | previous reference `444483ec` | re-made `6f6bb5c0` |
|---|---|---|
| follow-ups attempted / resolved | 53 / 42 (11 unreadable: prose cut at 256) | 53 / 53 |
| residual uncertain | 14 | 4 (all on one example, beyond the 3-follow-up cap) |
| `zoomFollowUp` marker: unreadable / failed / skipped | (rows predate the marker) | 0 / 0 / 0 |
| item gate approves | 39 | 43 |
| arm 1 vs reference: identical / hard flips | 85.7% / 59 | 86.5% / 65 |
| raw false passes (qwen pass, Sonnet fail) | 19 of 99 | 22 of 103 |
| raw false fails (qwen fail, Sonnet pass) | 40 of 398 | 43 of 404 |
| item gate agree, false accepts / rejects | 79.2%, 14 / 6 | 79.2%, 12 / 8 |
| dump | 73 items on 47 examples | 69 items on 40 examples |
