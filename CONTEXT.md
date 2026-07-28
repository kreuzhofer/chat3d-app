# Chat3D

AI-powered 3D CAD modeling: users describe parts in natural language chat, and an LLM pipeline produces Build123d code that is rendered into CAD files.

## Language

### LLM configuration

**Provider**:
A configured LLM endpoint (cloud API or self-hosted server) with credentials and a provider type that selects the SDK integration. Identified by name (e.g. `vllm-gx10`, `nebius`).
_Avoid_: backend, vendor

**Model**:
A named model served by a Provider, with capability flags (thinking, vision, embeddings, streaming) and token limits.

**Purpose**:
A pipeline role (e.g. `conversation`, `agent_codegen`, `vlm_eval`, `embedding`) that is assigned exactly one Model via the purpose map. Purposes are the unit of model selection.
_Avoid_: task type, use case

**Thinking effort**:
Per-model (or per-purpose override) control of reasoning depth: `low`/`medium`/`high`/`max`, or `off`. **`off` means the model does not reason at all** — for models whose serving template enables thinking by default, "off" must actively disable it, not merely skip enabling it.
_Avoid_: reasoning budget (that is one provider-specific realization of effort)

**Short internal call**:
A small utility LLM call with a tight output cap that is not user-visible chat (chat naming, tag suggestion, decomposition decision). Short internal calls always run with thinking off, regardless of the assigned Model's thinking configuration.
