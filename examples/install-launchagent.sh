#!/bin/sh
# Install or refresh the Alexa Echo MCP LaunchAgent for the current user:
#   com.alexa-echo-mcp.server   bearer-token HTTP MCP (KeepAlive, :8426 by default)
# Usage: sh examples/install-launchagent.sh [/absolute/path/to/node]
# Secrets stay in the Keychain; this script never reads or prints them.
set -eu
DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=$(CDPATH= cd -- "$DIR/.." && pwd)
NODE=${1:-$(command -v node || true)}
LABEL=com.alexa-echo-mcp.server
test -x "$NODE" || { echo "Node 22.5+ binary not found; pass its absolute path" >&2; exit 1; }
test -f "$REPO/dist/cli.js" || { echo "Build first: npm install && npm run build" >&2; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
plist="$HOME/Library/LaunchAgents/$LABEL.plist"
sed -e "s#REPLACE_NODE#$NODE#g" -e "s#REPLACE_REPO#$REPO#g" -e "s#REPLACE_HOME#$HOME#g" "$DIR/$LABEL.plist" > "$plist.tmp"
plutil -lint "$plist.tmp" >/dev/null
mv "$plist.tmp" "$plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Loaded $LABEL"
