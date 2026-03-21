#!/bin/bash
set -euo pipefail

NAME="${1:-}"
DB="event-trace.db"
OUT_DIR="recordings"

if [ -z "$NAME" ]; then
  echo "Usage: ./scripts/save-recording.sh <name>"
  echo "Example: ./scripts/save-recording.sh ClaudeTodos"
  echo ""
  if [ -d "$OUT_DIR" ]; then
    echo "Saved recordings:"
    ls -lh "$OUT_DIR"/*.db 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
  fi
  exit 1
fi

if [ ! -f "$DB" ]; then
  echo "No event-trace.db found. Run 'bun run dev' first to record events."
  exit 1
fi

mkdir -p "$OUT_DIR"
cp "$DB" "$OUT_DIR/$NAME.db"

COUNT=$(sqlite3 "$DB" "SELECT count(*) FROM events")
SOURCES=$(sqlite3 "$DB" "SELECT source, count(*) FROM events GROUP BY source ORDER BY count(*) DESC" | head -5)

echo "Saved recording '$NAME' ($COUNT events)"
echo "$SOURCES"
echo ""
echo "To convert:  bun run scripts/convert-trace.ts recordings/$NAME.db"
echo "To export:   cd ../super-one-flutter && ./scripts/export_fixtures.sh ../super-one/recordings/$NAME.db remote.out $NAME"
