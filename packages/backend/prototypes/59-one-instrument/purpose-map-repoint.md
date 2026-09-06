# Re-pointing the purpose map from the alias to the pooled served name (2026-09-06)

Why: `qwen38-nvfp4-spark` was a **display-name alias** on one deployment; the gateway substitutes a
display name into the node's `served_model_name` and requires it to be unique per active deployment, so an
aliased model can never have a second replica. The three-node pool publishes the recipe-native name
`qwen3.8-27b-nvfp4`. Daniel approved re-pointing `vlm_eval` permanently (via dgx-manager, 2026-09-06).
The alias pool disappeared from the gateway when spark-04 was re-made, and **ten** purposes pointed at it,
so the other nine need the same move or chat, codegen, spec generation and code review have no member.

Model rows on the pooled name (both created 2026-09-06, mirrors of the two alias rows):

| row | display name | default effort | mirrors |
|---|---|---|---|
| `98d284fe-0993-462a-9991-df15442531cb` | qwen3.8-27b-nvfp4 (thinking off, 3-node pool) | off | `6ed8f100` qwen38-nvfp4-spark (thinking off) |
| `bf0efc9b-d683-4c20-9ec5-79a5c1b8880c` | qwen3.8-27b-nvfp4 (3-node pool) | medium | `b20562b0` qwen38-nvfp4-spark |

Mapping (each purpose keeps its own `override_thinking_effort`, so the effective setting is unchanged):

| purpose | was (row `b20562b0`, default medium) | override | becomes |
|---|---|---|---|
| vlm_eval | qwen38-nvfp4-spark | off | `98d284fe` (Daniel's named target) |
| code_review | qwen38-nvfp4-spark | off | `bf0efc9b` |
| spec_generation | qwen38-nvfp4-spark | off | `bf0efc9b` |
| spec_enrichment | qwen38-nvfp4-spark | low | `bf0efc9b` |
| agent_codegen, workbench_codegen, conversation, decomposition_decision, prompt_distill, tag_suggest | qwen38-nvfp4-spark | (none → medium) | `bf0efc9b` |

The commands (admin token in `/tmp/chat3d-token.txt`), or the same edits in Admin → Providers → Purposes:

```bash
TOKEN=$(cat /tmp/chat3d-token.txt)
for p in agent_codegen code_review conversation decomposition_decision prompt_distill spec_enrichment spec_generation tag_suggest workbench_codegen; do
  curl -s -X PATCH "http://localhost/api/admin/llm-purposes/$p" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"modelId":"bf0efc9b-d683-4c20-9ec5-79a5c1b8880c"}'; echo
done
curl -s -X PATCH "http://localhost/api/admin/llm-purposes/vlm_eval" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"modelId":"98d284fe-0993-462a-9991-df15442531cb"}'; echo
```

Reversal is the same PATCH with the old row ids (`b20562b0` for the nine, `6ed8f100` or `b20562b0` for
vlm_eval) once a deployment publishes `qwen38-nvfp4-spark` again.
