#!/bin/bash
set -euo pipefail

# Chat3D Full Backup Script
# Creates a single .tar.gz archive containing:
#   - database.sql (PostgreSQL dump)
#   - storage.tar.gz (all generated files: models, screenshots, uploads)
#   - .env (environment configuration)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$PROJECT_DIR/chat3d-backup-$TIMESTAMP"

echo "=== Chat3D Backup ==="
echo "Project: $PROJECT_DIR"
echo "Output:  $BACKUP_DIR.tar.gz"
echo ""

mkdir -p "$BACKUP_DIR"

# 1. Database dump (portable SQL format)
echo "[1/3] Dumping PostgreSQL database..."
docker exec chat3d-postgres pg_dump -U chat3d -d chat3d --clean --if-exists \
  > "$BACKUP_DIR/database.sql"
DB_SIZE=$(wc -c < "$BACKUP_DIR/database.sql" | tr -d ' ')
echo "       Database dump: $(numfmt --to=iec "$DB_SIZE" 2>/dev/null || echo "$DB_SIZE bytes")"

# 2. File storage volume
echo "[2/3] Archiving file storage volume..."
# Determine the volume name (project directory name prefix + _storage)
VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep '_storage$' | head -1)
if [ -z "$VOLUME_NAME" ]; then
  echo "ERROR: Could not find Docker storage volume. Is the app running?"
  rm -rf "$BACKUP_DIR"
  exit 1
fi
docker run --rm \
  -v "$VOLUME_NAME":/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine tar czf /backup/storage.tar.gz -C /data \
    --exclude='./system-backups' \
    --exclude='./workbench-exports' \
    --exclude='./knowledge-exports' \
    .
STORAGE_SIZE=$(wc -c < "$BACKUP_DIR/storage.tar.gz" | tr -d ' ')
echo "       Storage archive: $(numfmt --to=iec "$STORAGE_SIZE" 2>/dev/null || echo "$STORAGE_SIZE bytes")"

# 3. Environment config
echo "[3/3] Copying .env..."
if [ -f "$PROJECT_DIR/.env" ]; then
  cp "$PROJECT_DIR/.env" "$BACKUP_DIR/.env"
else
  echo "       WARNING: No .env file found, skipping"
fi

# Package everything
echo ""
echo "Creating final archive..."
(cd "$PROJECT_DIR" && tar czf "chat3d-backup-$TIMESTAMP.tar.gz" "chat3d-backup-$TIMESTAMP")
rm -rf "$BACKUP_DIR"

FINAL_SIZE=$(wc -c < "$PROJECT_DIR/chat3d-backup-$TIMESTAMP.tar.gz" | tr -d ' ')
echo ""
echo "=== Backup complete ==="
echo "Archive: $PROJECT_DIR/chat3d-backup-$TIMESTAMP.tar.gz"
echo "Size:    $(numfmt --to=iec "$FINAL_SIZE" 2>/dev/null || echo "$FINAL_SIZE bytes")"
echo ""
echo "Transfer this file to the new machine, then run:"
echo "  ./scripts/restore.sh chat3d-backup-$TIMESTAMP.tar.gz"
