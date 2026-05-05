'use strict';

const { randomUUID } = require('crypto');

const TOKEN_TTL_DAYS = 7;

function generateToken() {
  const token = randomUUID();
  const expires_at = new Date();
  expires_at.setDate(expires_at.getDate() + TOKEN_TTL_DAYS);
  return { token, expires_at };
}

function isTokenExpired(expires_at) {
  if (!expires_at) return true;
  const d = new Date(expires_at);
  if (isNaN(d.getTime())) return true;
  return d < new Date();
}

module.exports = { generateToken, isTokenExpired, TOKEN_TTL_DAYS };
