---
name: deploy
description: Deploy timetracker to Render (push to main triggers auto-deploy)
disable-model-invocation: true
---

# Deploy Skill — Timetracker

Deploy the timetracker (LM PayTrack) to Render.com.

## Current State
- Branch: !`git branch --show-current`
- Status: !`git status --short`

## Instructions

Timetracker auto-deploys when you push to `main`. This skill:

1. **Check for uncommitted changes**
   ```bash
   git status
   ```
   If dirty, ask if user wants to commit first.

2. **Push to main**
   ```bash
   git push origin main
   ```

3. **Wait for Render deploy** (~2-3 minutes)

4. **Verify deployment**
   ```bash
   # Wait a moment, then check health
   curl -s https://paytrack.lemedspa.app/api/health
   ```
   Should return `{"status":"ok","timestamp":"..."}`

5. **Report results**
   - Production URL: https://paytrack.lemedspa.app
   - Admin panel: https://paytrack.lemedspa.app/admin

## Notes
- Render free tier spins down after 15 min inactivity
- First request after spin-down may take 30-60 seconds
- Keep-alive pings run every 14 minutes to prevent this
