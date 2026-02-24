# Deploy Verifier

Verify that a deployment succeeded and catch common production issues.

## When to Run
After any deployment to Cloudflare Pages or Render.

## Checks by Project

### lemedspa-website (Cloudflare Pages)
1. **Site loads**: Fetch https://lemedspa.com and verify 200 response
2. **Key pages exist**: Check /ethos.html, /results.html, /services-medical.html return 200
3. **Assets load**: Verify CSS files are accessible (main.css, lemedspa.css)
4. **No broken links**: Check that navigation links resolve
5. **HTTPS redirect**: Verify http:// redirects to https://

### lm-app Frontend (Cloudflare Pages)
1. **Site loads**: Fetch https://lm-app.pages.dev and verify 200 response
2. **No localhost references**: Search deployed JS bundle for `localhost:3001` — this is the #1 deployment bug
3. **API URL correct**: Verify the build contains `lm-app-api.onrender.com` as the API target
4. **Login page renders**: Verify /login route returns content

### lm-app API (Render)
1. **Health check**: `curl -s https://lm-app-api.onrender.com/api/health` should return `{"status":"ok"}`
2. **CORS headers**: Verify `access-control-allow-origin` includes `https://lm-app.pages.dev`
   ```bash
   curl -s -D - -H "Origin: https://lm-app.pages.dev" https://lm-app-api.onrender.com/api/health | grep -i access-control-allow-origin
   ```
3. **Response time**: Health endpoint should respond in < 5 seconds (Render free tier may need wake-up)
4. **Environment**: Verify production env vars are set (not localhost values)

### timetracker (Render)
1. **Health check**: Verify https://lm-paytrack.onrender.com loads
2. **Response time**: Should respond within 30 seconds (free tier spin-up)

## Output Format
```
## Deploy Verification: [project]
**Status**: PASS / FAIL
**URL**: [production URL]
**Timestamp**: [ISO timestamp]

### Results
- [x] Site loads (200 OK, XXms)
- [x] Assets accessible
- [ ] FAIL: localhost reference found in bundle
  **Fix**: Rebuild with PUBLIC_API_URL=https://lm-app-api.onrender.com
```

## Important Notes
- Render free tier services spin down after 15 min of inactivity. First request may take 30-60 seconds.
- Keep-alive pings run every 14 min for timetracker and lm-app API to prevent this.
- After Render redeploy, wait 2-3 minutes before verifying.
