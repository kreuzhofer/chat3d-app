# glm-5.3-flash at temperature 0 on an idle deployment — dgx-manager's probe, 2026-09-06

Requested from #56 finding 4 (temperature 0 not deterministic on glm; MTP suspected; the #56 probes
overlapped the experiment arm and could not isolate batch composition). Run by dgx-manager on deployment
`cmtmtc64857kx2auheovbmrla` (spark-02+03, the #56 recipe restarted from its stored blob) before the #59 run,
with the server confirmed idle throughout (`num_requests_running = 0` before and after).

32 identical requests, strictly sequential: the follow-up shape (thinking off, temperature 0, guided JSON
`{pass, detail}`), one synthetic flat-blue image, one question.

| replies | tokens | reply |
|---|---|---|
| 19 | 25 | `{"pass": true, "detail": "Uniform solid blue surface with no visible cracks, seams, or defects."}` |
| 7 | 24 | `{"pass": true, "detail": "Uniform blue surface with no visible cracks, seams, or defects."}` |
| 4 | 25 | `{"pass": true, "detail": "Uniform solid blue surface with no visible cracks, seams, or artifacts."}` |
| 1 | 44 | `{"pass": false, "detail": "...no visible part geometry, edges, or surfaces — no CAD part is discernible..."}` |
| 1 | 41 | `{"pass": false, "detail": "...the render appears blank, so no surface..."}` |

5 distinct replies of 32; **2 of 32 flipped the boolean** (6.3% on one fixed input).

- Ruled out: batch composition from concurrent traffic — there was none.
- Leading candidate: MTP (speculative decoding was active: 1,205 draft tokens, 738 accepted, ~61%). The
  number of accepted draft tokens varies per step, changing the per-forward token count and the
  floating-point reduction order; temperature 0 takes the argmax of logits that differ run to run.
- The MTP-disabled arm was not run: MTP lives in `--speculative-config` inside the stored recipe blob;
  `num_speculative_tokens=0` does not disable it; a no-MTP recipe variant plus two ~25-minute redeploys
  would have eaten the #59 window. Available on request with a proper window.
- Caveat: a blank render is an unusually ambiguous input ("is a blank render a pass?"), so 6.3% is an
  upper bound on a hard case; glm's 3.3–5.5% hard flips on real examples (#56, #58) is the better number.
