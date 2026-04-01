#!/bin/bash
set -euo pipefail

# Chat3D Full Restore Script
# Restores from a backup archive created by backup.sh
# Usage: ./scripts/restore.sh <path-to-backup.tar.gz>

if [ $# -lt 1 ]; then
  echo "Usage: $0 <path-to-backup.tar.gz>"
  exit 1
fi

ARCHIVE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESTORE_DIR="$PROJECT_DIR/restore-tmp-$$"

if [ ! -f "$ARCHIVE" ]; then
  echo "ERROR: Archive not found: $ARCHIVE"
  exit 1
fi

echo "=== Chat3D Restore ==="
echo "Archive: $ARCHIVE"
echo "Project: $PROJECT_DIR"
echo ""
echo "WARNING: This will REPLACE all existing data (database + files)."
read -p "Continue? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

# Extract archive
echo ""
echo "[1/4] Extracting archive..."
mkdir -p "$RESTORE_DIR"
tar xzf "$ARCHIVE" -C "$RESTORE_DIR" --strip-components=1

# Verify contents
for f in database.sql storage.tar.gz; do
  if [ ! -f "$RESTORE_DIR/$f" ]; then
    echo "ERROR: Missing expected file: $f"
    rm -rf "$RESTORE_DIR"
    exit 1
  fi
done

# Start postgres if not running
echo "[2/4] Ensuring PostgreSQL is running..."
cd "$PROJECT_DIR"
docker compose up -d postgres
echo "       Waiting for PostgreSQL to be ready..."
for i in $(seq 1 30); do
  if docker exec chat3d-postgres pg_isready -U chat3d -d chat3d >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "ERROR: PostgreSQL did not become ready in 30 seconds"
    rm -rf "$RESTORE_DIR"
    exit 1
  fi
  sleep 1
done
echo "       PostgreSQL is ready."

# Restore database
echo "[3/4] Restoring database..."
docker exec -i chat3d-postgres psql -U chat3d -d chat3d < "$RESTORE_DIR/database.sql"
echo "       Database restored."

# Restore file storage
echo "[4/4] Restoring file storage..."
VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep '_storage$' | head -1)
if [ -z "$VOLUME_NAME" ]; then
  # Create the volume by bringing up and stopping the backend briefly
  docker compose up -d backend
  sleep 2
  docker compose stop backend
  VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep '_storage$' | head -1)
fi
if [ -z "$VOLUME_NAME" ]; then
  echo "ERROR: Could not find or create Docker storage volume"
  rm -rf "$RESTORE_DIR"
  exit 1
fi
docker run --rm \
  -v "$VOLUME_NAME":/data \
  -v "$RESTORE_DIR":/backup:ro \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/storage.tar.gz -C /data"
echo "       File storage restored."

# Restore .env
if [ -f "$RESTORE_DIR/.env" ]; then
  if [ -f "$PROJECT_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env" "$PROJECT_DIR/.env.pre-restore"
    echo "       Existing .env backed up to .env.pre-restore"
  fi
  cp "$RESTORE_DIR/.env" "$PROJECT_DIR/.env"
  echo "       .env restored."
fi

# Clean up
rm -rf "$RESTORE_DIR"

echo ""
echo "=== Restore complete ==="
echo ""
echo "Next steps:"
echo "  1. Review .env and update any machine-specific settings"
echo "  2. Rebuild and start all services:"
echo "     docker compose up -d --build"
echo "  3. Verify: login, check chat history, workbench, experiments"
