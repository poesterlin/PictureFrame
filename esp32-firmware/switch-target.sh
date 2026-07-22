#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-}"
if [ "$TARGET" != "esp32c6" ] && [ "$TARGET" != "esp32s3" ]; then
	echo "Usage: $0 <esp32c6|esp32s3>"
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDKCONFIG_DEST="$SCRIPT_DIR/sdkconfig"
SDKCONFIG_SRC="$SCRIPT_DIR/sdkconfig.$TARGET"

if [ ! -f "$SDKCONFIG_SRC" ]; then
	echo "Error: $SDKCONFIG_SRC not found"
	exit 1
fi

CURRENT_TARGET=""
if [ -f "$SDKCONFIG_DEST" ]; then
	CURRENT_TARGET=$(grep -oP 'CONFIG_IDF_TARGET="\K[^"]+' "$SDKCONFIG_DEST" || true)
fi

if [ "$CURRENT_TARGET" != "$TARGET" ]; then
	echo "Switching from '${CURRENT_TARGET:-none}' to '$TARGET'"
	cp "$SDKCONFIG_SRC" "$SDKCONFIG_DEST"
	idf.py fullclean
	idf.py set-target "$TARGET"
else
	echo "Already targeting $TARGET"
	if ! cmp -s "$SDKCONFIG_SRC" "$SDKCONFIG_DEST"; then
		echo "sdkconfig differs from template, restoring..."
		cp "$SDKCONFIG_SRC" "$SDKCONFIG_DEST"
		idf.py fullclean
	fi
fi

echo ""
echo "Target: $TARGET"
echo ""
echo "Next steps:"
echo "  idf.py menuconfig   # optional: review settings"
echo "  idf.py build        # compile"
echo "  idf.py flash        # flash to device"
