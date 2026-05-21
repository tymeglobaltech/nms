#!/bin/bash

# NMS data.json backup script
# Keeps the last 30 daily backups

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_FILE="$SCRIPT_DIR/data.json"
BACKUP_DIR="$SCRIPT_DIR/backups"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
BACKUP_FILE="$BACKUP_DIR/data_$TIMESTAMP.json"
KEEP=30

if [ ! -f "$DATA_FILE" ]; then
  echo "ERROR: $DATA_FILE not found" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

cp "$DATA_FILE" "$BACKUP_FILE"
echo "Backup saved: $BACKUP_FILE"

# Remove old backups, keeping only the most recent $KEEP
COUNT=$(ls -1 "$BACKUP_DIR"/data_*.json 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  REMOVE=$((COUNT - KEEP))
  ls -1t "$BACKUP_DIR"/data_*.json | tail -n "$REMOVE" | xargs rm -f
  echo "Removed $REMOVE old backup(s), keeping $KEEP"
fi
