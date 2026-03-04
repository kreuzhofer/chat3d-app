#!/usr/bin/env bash
# Pre-tool-use hook: auto-increment the build version before every git commit.
# Reads JSON from stdin; only acts when the Bash command is a git commit.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only trigger on git commit commands
if ! echo "$COMMAND" | grep -qE '^\s*git\s+commit\b'; then
  exit 0
fi

VERSION_FILE="${CLAUDE_PROJECT_DIR}/packages/frontend/src/version.ts"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Warning: version file not found at $VERSION_FILE" >&2
  exit 0
fi

# Parse current version (e.g., "0.1.42") — macOS-compatible grep
CURRENT=$(grep -o 'APP_VERSION = "[^"]*"' "$VERSION_FILE" | grep -o '"[^"]*"' | tr -d '"')
if [[ -z "$CURRENT" ]]; then
  echo "Warning: could not parse APP_VERSION from $VERSION_FILE" >&2
  exit 0
fi

# Split into major.minor.patch and increment patch
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${NEW_PATCH}"

# Write updated version
sed -i '' "s/APP_VERSION = \"${CURRENT}\"/APP_VERSION = \"${NEW_VERSION}\"/" "$VERSION_FILE"

# Stage the version file so it's included in the commit
git -C "$CLAUDE_PROJECT_DIR" add "$VERSION_FILE"

echo "Bumped version: ${CURRENT} -> ${NEW_VERSION}" >&2
exit 0
