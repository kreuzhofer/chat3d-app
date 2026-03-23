# Tool Use Training Datasets for Fine-Tuning

Research into publicly available datasets for improving tool use / function calling in fine-tuned OSS models (e.g., Llama, Qwen, Mistral). Goal: mix these into our Build123d domain-specific training data so the model learns when and how to invoke tools correctly.

## Tier 1: Production-Proven (Start Here)

### Salesforce/xlam-function-calling-60k
- **URL:** https://huggingface.co/datasets/Salesforce/xlam-function-calling-60k
- **Paper:** https://arxiv.org/abs/2406.18518
- **Size:** 60,000 examples
- **Format:** JSON with `query`, `tools` (API schemas), and `answers` (correct function calls with arguments). Covers single-call, multiple-choice, parallel, and parallel-multiple scenarios.
- **Quality:** 3-stage verification (format, execution, semantic). Human evaluation >95% correctness. Models trained on this hit #1 on Berkeley Function-Calling Leaderboard (BFCL).
- **License:** CC-BY-4.0
- **Why:** Best single starting point. Verified, diverse, with proven fine-tuning recipes (HuggingFace cookbook).

### Salesforce/APIGen-MT-5k
- **URL:** https://huggingface.co/datasets/Salesforce/APIGen-MT-5k
- **Paper:** https://arxiv.org/abs/2504.03601
- **Size:** 5,000 multi-turn trajectories
- **Format:** Multi-turn agent-human interactions with tool calls, tool responses, and natural language.
- **Quality:** Two-phase verified pipeline. Trained xLAM-2-fc-r models that outperform GPT-4o and Claude 3.5 on tau-bench and BFCL.
- **License:** Salesforce Research
- **Why:** Highest-quality multi-turn data available. Small but extremely effective.

### NousResearch/hermes-function-calling-v1
- **URL:** https://huggingface.co/datasets/NousResearch/hermes-function-calling-v1
- **Size:** ~100K examples
- **Format:** ShareGPT structure. Includes function-calling, JSON-mode output, agentic JSON-mode, and structured extraction. System prompts use `<tools></tools>` XML tags.
- **Quality:** Powers the Hermes 2 Pro model line. 90% on Fireworks function calling eval. Includes cleaned Glaive data + in-house generated data.
- **License:** Apache-2.0
- **Why:** Battle-tested, covers both tool calling AND structured output. ShareGPT format works with most fine-tuning frameworks.

### Team-ACE/ToolACE
- **URL:** https://huggingface.co/datasets/Team-ACE/ToolACE
- **Paper:** https://arxiv.org/abs/2409.00920 (ICLR 2025)
- **Size:** ~10B download, 26,507 APIs
- **Format:** Multi-turn dialogs via multi-agent interplay with complexity evaluation. Dual-layer verification (rule-based + model-based).
- **Quality:** ToolACE-8B (fine-tuned LLaMA-3.1-8B) achieved SOTA on BFCL, rivaling GPT-4. Cleaned Qwen version at `tryumanshow/ToolACE-Qwen-cleaned`.
- **License:** Research
- **Why:** Particularly good for complex tool selection scenarios.

### NVIDIA/Nemotron-Agentic-v1
- **URL:** https://huggingface.co/datasets/nvidia/Nemotron-Agentic-v1
- **Size:** 181,000 examples (32GB JSONL)
- **Format:** Synthetic multi-turn trajectories with three roles: user, agent, and tool execution environment. Captures goal decomposition, tool call decisions, and reasoning over tool outputs.
- **Quality:** Production-grade. Used to train the Nemotron model family.
- **License:** CC-BY-4.0
- **Why:** Largest high-quality agentic dataset. The three-role format is ideal for training when-to-call decisions.

## Tier 2: Strong Supplements

### Nanbeige/ToolMind
- **URL:** https://huggingface.co/datasets/Nanbeige/ToolMind
- **Paper:** https://arxiv.org/abs/2511.15718
- **Size:** 360K total (160K synthetic + 200K augmented)
- **Format:** Multi-turn trajectories with explicit reasoning traces. Graph-based function sampling, multi-agent trajectory synthesis, turn-level quality filtering.
- **Quality:** Fine-tuning Qwen3-14B showed +5.40% on BFCL-v4 and +14.22% on tau-bench.
- **License:** Research
- **Why:** Reasoning traces before tool calls are uniquely valuable for training models that think before acting.

### interstellarninja/hermes_reasoning_tool_use
- **URL:** https://huggingface.co/datasets/interstellarninja/hermes_reasoning_tool_use
- **Size:** 51,004 conversations
- **Format:** OpenAI-style ShareGPT with per-episode tool schemas and scenario labels. Built with Nous Research Atropos RL stack, BFCL v3 aligned.
- **License:** Apache-2.0
- **Why:** Designed for SFT warmup before GRPO/RL. Modern and well-structured.

### glaiveai/glaive-function-calling-v2 (use cleaned derivatives)
- **URL:** https://huggingface.co/datasets/glaiveai/glaive-function-calling-v2
- **Size:** ~113,000 examples
- **Format:** System prompts with function definitions, multi-turn conversations with `<functioncall>` JSON.
- **Quality:** Most widely used but has known issues (invalid JSON, unclear roles). Use cleaned versions instead.
- **License:** Apache-2.0
- **Cleaned derivatives:**
  - `hypervariance/function-calling-sharegpt` (86K, ShareGPT format)
  - `hiyouga/glaive-function-calling-v2-sharegpt`
  - `Locutusque/function-calling-chatml` (ChatML format)

### OpenBMB/ToolBench (ToolLLM)
- **URL:** https://github.com/OpenBMB/ToolBench
- **Paper:** https://arxiv.org/abs/2307.16789 (ICLR 2024 Spotlight)
- **Size:** 12,657 instructions, 16,464 real APIs from RapidAPI, ~188K rows on HuggingFace
- **Format:** Multi-step reasoning traces with real API calls across 49 categories.
- **License:** Apache-2.0
- **Why:** Best for training complex multi-step tool chaining with real API grounding.

### OpenBMB/WorkflowBench (WorkflowLLM)
- **URL:** https://huggingface.co/datasets/openbmb/WorkflowLLM
- **Paper:** https://arxiv.org/abs/2411.05451
- **Size:** 106,763 samples, 1,503 APIs from 83 applications
- **Format:** Python-style workflow code with hierarchical thought traces.
- **License:** Research
- **Why:** Focus on multi-step workflow orchestration (chaining tool calls).

## Tier 3: Specialized / Niche

### NVIDIA/When2Call
- **URL:** https://huggingface.co/datasets/nvidia/When2Call
- **Paper:** https://arxiv.org/abs/2504.18851 (NAACL 2025)
- **Format:** Multiple-choice focused on when to call tools, when to ask follow-ups, when to decline.
- **Why:** Specifically targets the "should I call a tool?" decision. Even SOTA models show gaps here.

### IBM/API-BLEND
- **URL:** https://github.com/IBM/API-BLEND
- **Paper:** https://arxiv.org/abs/2402.15491 (ACL 2024)
- **Size:** 190K+ instances
- **Format:** Three task types: API/tool detection, slot filling, API sequencing.
- **Why:** Best for training the detection aspect — deciding WHEN to call a tool.

### driaforall/pythonic-function-calling
- **URL:** https://huggingface.co/datasets/driaforall/pythonic-function-calling
- **Size:** ~50K
- **Format:** Models output Python code blocks instead of JSON to interact with tools. Includes chained calls with reasoning.
- **License:** Apache-2.0
- **Why:** Since our pipeline generates Python (Build123d), the Pythonic tool calling paradigm may align naturally.

### AymanTarig/function-calling-v0.2-with-r1-cot
- **URL:** https://huggingface.co/datasets/AymanTarig/function-calling-v0.2-with-r1-cot
- **Size:** ~60K
- **Format:** xlam-function-calling-60k augmented with chain-of-thought reasoning from DeepSeek-R1.
- **Why:** Adds reasoning to the proven xLAM data.

### Jofthomas/hermes-function-calling-thinking-V1
- **URL:** https://huggingface.co/datasets/Jofthomas/hermes-function-calling-thinking-V1
- **Size:** 1K-10K
- **Format:** hermes-function-calling-v1 augmented with R1-style thinking traces.
- **Why:** Small but valuable for training models that think before calling tools.

### gorilla-llm/APIBench
- **URL:** https://huggingface.co/datasets/gorilla-llm/APIBench
- **Paper:** https://arxiv.org/abs/2305.15334
- **Size:** 16.2K (1,715 ML APIs)
- **License:** Apache-2.0
- **Why:** Seminal paper. Narrower domain (ML APIs) but high quality.

### BUTTONInstruct (ICLR 2025)
- **Paper:** https://arxiv.org/abs/2410.12952
- **URL:** https://github.com/PKU-Baichuan-MLSystemLab/BUTTON
- **Size:** 8K
- **Format:** Compositional multi-turn via bottom-up atomic task construction + top-down multi-agent trajectory generation.
- **Why:** Small but specifically designed for complex multi-turn compositional tool use.

### NVIDIA/Nemotron-RL-Agentic-Conversational-Tool-Use-Pivot-v1
- **URL:** https://huggingface.co/datasets/nvidia/Nemotron-RL-Agentic-Conversational-Tool-Use-Pivot-v1
- **Size:** ~50K
- **Format:** RL preference data with multi-turn trajectories and preference signals.
- **License:** CC-BY-4.0
- **Why:** For RL/DPO training after SFT (two-stage approach).

### Other References
- **API-Bank** (EMNLP 2023) — https://arxiv.org/abs/2304.08244 — 1,888 training dialogues, 2,138 APIs
- **ToolAlpaca** — https://arxiv.org/abs/2306.05301 — 3,938 instances, 400+ real APIs
- **Trelis/function_calling_v3** — https://huggingface.co/datasets/Trelis/function_calling_v3 — <1K, human-written, no contamination

## Evaluation Benchmark (Do NOT Train On)

### gorilla-llm/Berkeley-Function-Calling-Leaderboard (BFCL)
- **URL:** https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard
- **Format:** Expert-curated scenarios across Python, Java, JavaScript. AST-based evaluation.
- **License:** Apache-2.0
- **Use:** Gold standard eval benchmark only.

## Recommended Mix for Chat3D

Our pipeline needs: (1) decide when to trigger `tool_use` for 3D model generation, (2) generate correct tool call JSON, (3) handle multi-turn with tool results, (4) chain calls.

### Core mix (~230K examples)
1. **xlam-function-calling-60k** — foundation for correct tool call generation
2. **hermes-function-calling-v1** — multi-turn + structured output
3. **Nemotron-Agentic-v1** — when-to-call decisions + multi-step reasoning
4. **ToolMind** — reasoning traces for complex decisions

### Targeted supplements
- **When2Call** — improves the "should I call a tool?" decision
- **APIGen-MT-5k** — highest quality multi-turn data
- **driaforall/pythonic-function-calling** — aligns with our Python/Build123d code generation paradigm

### Practical guidance from literature
- **2,000–6,000 high-quality function calling samples mixed into domain data is surprisingly effective** at 7B–30B scale (Parlance Labs, W&B research)
- Fine-tune on instruction-tuned models (not base)
- Pre-shuffle tool-use data with Build123d domain data
- LoRA works well for this
- HuggingFace cookbook has step-by-step recipe using xLAM data with Llama/Qwen/Mistral

### Key resources
- HuggingFace Cookbook: https://huggingface.co/learn/cookbook/en/function_calling_fine_tuning_llms_on_xlam
- W&B Guide: https://wandb.ai/wandb/function-calling-finetuning/reports/Fine-tuning-LLMs-for-function-calling--VmlldzoxMjgxMTgxMg
- Parlance Labs: https://parlance-labs.com/education/fine_tuning/pawel.html
- admarcosai Collection: https://huggingface.co/collections/admarcosai/function-calling-dataset-656c498b27cb1927ca276e8a
