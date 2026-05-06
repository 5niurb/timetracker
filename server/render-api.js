'use strict';

// Updates a Render service env var via the Render API.
// Used to persist PLAID_ACCESS_TOKEN and PLAID_CURSOR after sync.
async function updateRenderEnvVar(key, value) {
  const apiKey = process.env.RENDER_API_KEY;
  const serviceId = process.env.RENDER_SERVICE_ID;
  if (!apiKey || !serviceId) {
    throw new Error('RENDER_API_KEY and RENDER_SERVICE_ID are required to update env vars');
  }

  const listResp = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!listResp.ok) {
    throw new Error(`Render API list env-vars failed: ${listResp.status}`);
  }

  const envVars = await listResp.json();
  const existing = envVars.find((v) => v.envVar?.key === key);

  const url = existing
    ? `https://api.render.com/v1/services/${serviceId}/env-vars/${existing.envVar.id}`
    : `https://api.render.com/v1/services/${serviceId}/env-vars`;

  const method = existing ? 'PUT' : 'POST';
  const body = existing ? { value } : { key, value };

  const updateResp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!updateResp.ok) {
    const text = await updateResp.text();
    throw new Error(`Render API update env-var failed: ${updateResp.status} — ${text}`);
  }
}

module.exports = { updateRenderEnvVar };
