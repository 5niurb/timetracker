'use strict';

// Updates a Render service env var via the Render API.
// Used to persist PLAID_ACCESS_TOKEN and PLAID_CURSOR after sync.
//
// Render v1 API only supports bulk PUT /env-vars (replaces all vars).
// POST and individual-key endpoints return 405. Pattern: fetch all, merge, PUT.
//
// CRITICAL: Dashboard-set env vars are NOT returned by GET /env-vars — only vars
// set via this API are returned. All required vars must be set via API (not dashboard)
// so the merge is complete. If vars go missing after a PUT, check that they were
// set via API, not just the Render dashboard.
async function updateRenderEnvVar(key, value) {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) {
    throw new Error('RENDER_API_KEY and RENDER_SERVICE_ID are required to update env vars');
  }

  const base = `https://api.render.com/v1/services/${serviceId}/env-vars`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const listResp = await fetch(base, { headers });
  if (!listResp.ok) {
    throw new Error(`Render API list env-vars failed: ${listResp.status}`);
  }

  const listBody = await listResp.json();
  const existing = Array.isArray(listBody) ? listBody : (listBody.envVars || []);

  // Merge: replace the target key if present, otherwise append it.
  const found = existing.some((v) => v.envVar?.key === key);
  const merged = found
    ? existing.map((v) => (v.envVar?.key === key ? { key, value } : { key: v.envVar.key, value: v.envVar.value }))
    : [...existing.map((v) => ({ key: v.envVar.key, value: v.envVar.value })), { key, value }];

  const updateResp = await fetch(base, {
    method: 'PUT',
    headers,
    body: JSON.stringify(merged),
  });

  if (!updateResp.ok) {
    const text = await updateResp.text();
    console.warn('Render API update env-var error body:', text);
    throw new Error(`Render API update env-var failed: ${updateResp.status}`);
  }
}

module.exports = { updateRenderEnvVar };
