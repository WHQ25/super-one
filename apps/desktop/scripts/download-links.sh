#!/bin/bash
TAG=${1:-$(gh release list --limit 1 --json tagName -q '.[0].tagName')}
OUT="download-links.md"
TOKEN=$(gh auth token)
ASSETS=$(gh release view "$TAG" --json assets --jq '.assets[] | select(.name | test("\\.(dmg|exe|AppImage)$")) | "\(.name)|\(.apiUrl)"')

{
  echo "# SuperOne $TAG Download Links"
  echo ""
  echo "> Links expire in ~1 hour. Re-run \`./scripts/download-links.sh\` to regenerate."
  echo ""
  echo "| Platform | Download |"
  echo "|----------|----------|"

  while IFS='|' read -r name url; do
    LINK=$(curl -sI -H "Authorization: token $TOKEN" -H "Accept: application/octet-stream" "$url" 2>&1 | grep -i "^location:" | sed 's/location: //' | tr -d '\r')
    case "$name" in
      *.dmg)       platform="macOS" ;;
      *.exe)       platform="Windows" ;;
      *arm64*)     platform="Linux (ARM64)" ;;
      *.AppImage)  platform="Linux (x64)" ;;
    esac
    echo "| $platform | [$name]($LINK) |"
  done <<< "$ASSETS"
} > "$OUT"

echo "Generated $OUT"
