/**
 * Flatten multi-file Build123d projects into a single code string for evaluation.
 *
 * The code generator produces multi-file projects (main.py + components/*.py).
 * For code evaluation, we inline all component files into one seamless script
 * so the reviewer sees a single, self-contained piece of code — no confusing
 * import markers or cross-file references.
 */

interface ProjectFile {
  path: string;
  content: string;
}

/**
 * Flatten project files into a single code string for evaluation.
 *
 * - Component files are placed first (dependencies before main)
 * - `from components.X import Y` lines are removed (code is inlined)
 * - `# --- path ---` markers are NOT used (avoids confusing the reviewer)
 * - A minimal `# Component: X` header separates sections for readability
 */
export function flattenForEval(files: ProjectFile[]): string {
  if (files.length <= 1) {
    return files[0]?.content ?? "";
  }

  // Separate main from components
  const main = files.find(f => f.path === "main.py") ?? files[files.length - 1];
  const components = files.filter(f => f !== main);

  const parts: string[] = [];

  // Add components first (inlined, no imports needed)
  for (const comp of components) {
    const name = comp.path.replace(/\.py$/, "").replace(/^components\//, "");
    // Strip any "from build123d import *" at the top of component files
    // since it will already be in main.py or is implicit
    let content = comp.content.replace(/^from build123d import \*\s*\n?/m, "");
    content = content.trim();
    if (content) {
      parts.push(`# ── Component: ${name} ──\n${content}`);
    }
  }

  // Add main file with component imports stripped
  let mainContent = main.content;
  // Remove "from components.X import Y" lines — the code is already inlined above
  mainContent = mainContent.replace(
    /^from components\.\w+ import .+\n?/gm,
    "",
  );
  mainContent = mainContent.trim();
  if (mainContent) {
    parts.push(`# ── Assembly ──\n${mainContent}`);
  }

  return parts.join("\n\n");
}

/**
 * Flatten already-stored code that may contain `# --- path ---` markers.
 *
 * Stored examples save code as a single string. If it was a multi-file project,
 * the string contains `# --- components/X.py ---` sections. This function
 * parses them back into files and re-flattens for eval.
 */
export function flattenStoredCode(code: string): string {
  // If no file markers, return as-is (single-file project)
  if (!code.includes("# --- ")) {
    return code;
  }

  // Split on "# --- <path> ---" markers
  const sections = code.split(/^# --- (.+?) ---\s*$/m);
  // sections alternates: [preamble, path1, content1, path2, content2, ...]

  const files: ProjectFile[] = [];
  for (let i = 1; i < sections.length; i += 2) {
    const path = sections[i].trim();
    const content = (sections[i + 1] ?? "").trim();
    if (path && content) {
      files.push({ path, content });
    }
  }

  if (files.length === 0) {
    return code; // Couldn't parse, return original
  }

  return flattenForEval(files);
}
