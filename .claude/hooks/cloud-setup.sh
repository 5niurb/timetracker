#!/bin/bash
# Cloud environment bootstrap for timetracker
# Runs on SessionStart — detects cloud VM and installs dependencies

if [ -n "$CLAUDE_CODE_REMOTE" ] || [ ! -d "/c/Users/LMOperations" ]; then
  echo "Cloud session detected — bootstrapping environment..."
  npm install -g prettier 2>/dev/null || true
  echo "Cloud bootstrap complete."
fi
