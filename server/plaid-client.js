'use strict';

const { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } = require('plaid');

let _client = null;

function getClient() {
  if (_client) return _client;
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';
  if (!clientId || !secret) {
    throw new Error('PLAID_CLIENT_ID and PLAID_SECRET env vars are required');
  }
  const basePath = PlaidEnvironments[env];
  if (!basePath) {
    throw new Error(
      `Invalid PLAID_ENV "${env}". Valid values: ${Object.keys(PlaidEnvironments).join(', ')}`,
    );
  }
  const config = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET': secret,
      },
    },
  });
  _client = new PlaidApi(config);
  return _client;
}

function isConfigured() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

async function createLinkToken(userId = 'paytrack-admin') {
  const client = getClient();
  const response = await client.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: 'LM PayTrack',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  });
  return response.data.link_token;
}

async function exchangePublicToken(publicToken) {
  const client = getClient();
  const response = await client.itemPublicTokenExchange({ public_token: publicToken });
  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

// Fetches all new/modified transactions since cursor.
// Returns { added, modified, removed, nextCursor, hasMore }
// IMPORTANT: If this throws mid-pagination, callers must use the last persisted
// cursor on retry — not the original cursor passed in. Persist nextCursor to DB
// after each successful call, not only after a full sync run completes.
async function syncTransactions(accessToken, cursor = null) {
  const client = getClient();
  const allAdded = [];
  const allModified = [];
  const allRemoved = [];
  let nextCursor = cursor;
  let hasMore = true;

  while (hasMore) {
    const params = { access_token: accessToken };
    if (nextCursor) params.cursor = nextCursor;

    const response = await client.transactionsSync(params);
    const data = response.data;

    allAdded.push(...data.added);
    allModified.push(...data.modified);
    allRemoved.push(...data.removed);
    nextCursor = data.next_cursor;
    hasMore = data.has_more;
  }

  return {
    added: allAdded,
    modified: allModified,
    removed: allRemoved,
    nextCursor,
    hasMore: false,
  };
}

module.exports = { createLinkToken, exchangePublicToken, syncTransactions, isConfigured };
