/**
 * The agent's tool definitions in OpenAI function-calling shape, for the
 * `tools` field of every exported trajectory. Mirrors the Zod schemas from
 * agent-tools.service.ts, without execute fns.
 */
import { zodSchema } from "ai";
import { z } from "zod";

export interface OpenAIToolDef {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

function buildToolDef(name: string, description: string, schema: z.ZodObject<any>): OpenAIToolDef {
  const jsonSch = zodSchema(schema).jsonSchema;
  return { type: "function", function: { name, description, parameters: jsonSch } };
}

export function getAgentToolDefinitions(): OpenAIToolDef[] {
  return [
    buildToolDef(
      "text_editor",
      `A text editor for viewing and editing Python files in the project directory.

Commands:
- view: View file contents with line numbers. Optionally specify view_range as [startLine, endLine].
- create: Create a new file with the given content. Fails if the file already exists — use str_replace to edit.
- str_replace: Replace exactly one occurrence of old_str with new_str in the file. The old_str must match exactly one location; include enough surrounding context to make it unique.
- insert: Insert new text after the specified line number. Use insert_line=0 to prepend.
- overwrite: Replace entire contents of an existing file. Prefer str_replace for targeted edits.

All paths are relative (e.g., "main.py", "components/base.py"). Only .py files are allowed.
Always view a file before editing it to see the current line numbers and content.`,
      z.object({
        command: z.enum(["view", "create", "str_replace", "insert", "overwrite"]).describe("The editor command to execute"),
        path: z.string().describe("Relative file path (e.g., 'main.py')"),
        file_text: z.string().optional().describe("Full file content for 'create' or 'overwrite' command"),
        old_str: z.string().optional().describe("Exact string to find for 'str_replace' — must match exactly one location"),
        new_str: z.string().optional().describe("Replacement string for 'str_replace', or text to insert for 'insert'"),
        view_range: z.array(z.number()).length(2).optional().describe("[startLine, endLine] to view a specific range (1-indexed)"),
        insert_line: z.number().optional().describe("Line number to insert after (0 = prepend) for 'insert' command"),
      }),
    ),
    buildToolDef(
      "validate_code",
      "Validate your Build123d code for syntax errors and common mistakes. This is fast and free — always validate before rendering. Validates all files in the project.",
      z.object({}),
    ),
    buildToolDef(
      "render_project",
      "Render the project to produce 3D model files (STEP, STL, 3MF). This is expensive — only call after validation passes. Executes main.py as the entry point.",
      z.object({}),
    ),
    buildToolDef(
      "validate_and_render",
      "Validate and render in one step. Validates first; if validation passes, renders immediately. Use this when you're confident the code is ready. Saves a round-trip compared to calling validate_code then render_project separately.",
      z.object({}),
    ),
    buildToolDef(
      "evaluate_model",
      "Evaluate the rendered 3D model against the user's prompt using a vision model (VLM). Takes screenshots and scores the model 1-10. Only call after a successful render. Use this to check quality before submitting — submit_result also runs evaluation automatically.",
      z.object({}),
    ),
    buildToolDef(
      "evaluate_code",
      "Review your code for correctness against the user's prompt. Runs two checks: (1) Assertion check — verifies numeric parameters (dimensions, counts) match the spec (free, instant). (2) Code review — an LLM reviews the code for parameter accuracy, feature completeness, and logical correctness (cheap, ~5s). Call this BEFORE rendering to catch dimensional errors early. You do NOT need a rendered model for this.",
      z.object({}),
    ),
    buildToolDef(
      "submit_result",
      "Submit your result after a successful render. Automatically runs a visual evaluation (VLM) to check quality. If the score is below the acceptance threshold, the submission is REJECTED and you must address the issues before re-submitting.",
      z.object({
        summary: z.string().describe("Brief summary of what was built or changed"),
      }),
    ),
    buildToolDef(
      "list_files",
      "List files in the project with line counts. Cheaper than viewing each file individually.",
      z.object({
        directory: z.string().optional().describe("Optional directory to filter by (e.g., 'components')"),
      }),
    ),
    buildToolDef(
      "search_examples",
      "Search the workbench for similar Build123d examples. Use this to see how similar models are built. Returns up to 3 examples with their prompt and code.",
      z.object({
        query: z.string().describe("Natural language description of what you're looking for (e.g., 'gear with rounded teeth', 'box with lid')"),
      }),
    ),
    buildToolDef(
      "search_knowledge",
      "Search the Build123d external knowledge base (official docs, repo examples, test patterns, and reference material like specs and dimensions) for working code snippets or technical reference related to a technique or concept. Use when you need to see how a specific API or pattern works, or when you need dimensions/specifications for components.",
      z.object({
        query: z.string().describe("Natural language description of what you want to find (e.g., 'how to create a helix sweep', 'loft between two sketches')"),
      }),
    ),
    buildToolDef(
      "lookup_api",
      "Look up Build123d API reference documentation for a specific topic. Available topics: primitives_3d, primitives_2d, sketch_ops, operations_3d, boolean, positioning, edge_face_selection, fillets_chamfers, offset_shell, arrays_patterns, build_contexts, buildline, sweep, loft, sketch_on_face, revolve, parametric_math",
      z.object({
        topic: z.string().describe("The API topic to look up (e.g., 'sweep', 'boolean', 'fillets_chamfers')"),
      }),
    ),
  ];
}
