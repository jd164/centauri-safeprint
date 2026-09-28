#!/usr/bin/env bash
echo "==================================================="
echo "  Centauri Carbon SafePrint - Anti-Runout Guard"
echo "==================================================="
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js was not found on your system!"
    echo "Please install Node.js v18 or newer from: https://nodejs.org"
    exit 1
fi

echo "Starting SafePrint server..."

# Attempt to open default web browser in background
if command -v xdg-open &> /dev/null; then
    (sleep 1 && xdg-open http://localhost:3000) &
elif command -v open &> /dev/null; then
    (sleep 1 && open http://localhost:3000) &
fi

node src/server.js "$@"
