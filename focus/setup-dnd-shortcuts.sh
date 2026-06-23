#!/bin/bash
# One-time helper for the Focus app's Do-Not-Disturb toggle.
#
# It needs two Shortcuts named exactly "MX Focus On" and "MX Focus Off"
# (each a "Set Focus -> Do Not Disturb, Turn On / Off" action). macOS does NOT
# allow creating signed shortcuts from the command line, so this script detects
# what's missing and walks you through making them. The Focus timer works fine
# without them — only the DND toggle needs them.
set -uo pipefail

have() { /usr/bin/shortcuts list 2>/dev/null | grep -qx "$1"; }

missing=()
have "MX Focus On"  || missing+=("MX Focus On")
have "MX Focus Off" || missing+=("MX Focus Off")

if [ ${#missing[@]} -eq 0 ]; then
	echo "✅ 'MX Focus On' and 'MX Focus Off' both exist — Focus DND is ready."
	exit 0
fi

echo "Missing shortcut(s): ${missing[*]}"
echo
echo "Create each one (≈30 seconds):"
echo "  1. The Shortcuts app opens a new, empty shortcut."
echo "  2. Search the action list for 'Set Focus' (or 'Do Not Disturb')."
echo "  3. Add it; set it to 'Turn Do Not Disturb On'  -> name the shortcut 'MX Focus On'"
echo "                       'Turn Do Not Disturb Off' -> name the shortcut 'MX Focus Off'"
echo "     (rename via the title at the top of the editor)."
echo "  4. Close the editor (it saves automatically)."
echo
read -r -p "Open Shortcuts now to create '${missing[0]}'? [Y/n] " ans
case "${ans:-Y}" in
	[Nn]*) echo "Skipped. Open Shortcuts yourself, then re-run this script to verify." ;;
	*) open "shortcuts://create-shortcut" 2>/dev/null || open -b com.apple.shortcuts ;;
esac
echo
echo "Re-run this script any time to check:  npm run setup-dnd  (in focus/)"
