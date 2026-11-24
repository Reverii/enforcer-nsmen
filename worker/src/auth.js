// Verifies Telegram Mini App initData using Web Crypto HMAC-SHA256.
// Ported from BDO Picker's apps-script/Auth.gs.
// Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

import { RuleError } from './rules.js';

const encoder = new TextEncoder();

function authFail() {
  return new RuleError('AUTH', 'Open Enforcer NSMEN from the Telegram link.', 401);
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

function toBase64Url(str) {
  const bytes = encoder.encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64) {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export const EXPORT_TOKEN_TTL_SEC = 300; // 5 minutes

export async function createExportToken({ tgId, dept, workYear, exp }, botToken) {
  if (!botToken || typeof botToken !== 'string') {
    throw new RuleError('INTERNAL', 'Bot token not configured.', 500);
  }
  const payload = {
    tgId: String(tgId),
    dept: String(dept),
    workYear: Number(workYear),
    exp: Number(exp),
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const key = await hmacSha256(encoder.encode('ExportLink'), botToken);
  const sig = toHex(await hmacSha256(key, encoded));
  return `${encoded}.${sig}`;
}

export async function verifyExportToken(token, botToken, nowSec = Math.floor(Date.now() / 1000)) {
  if (!token || typeof token !== 'string' || !botToken || typeof botToken !== 'string') {
    throw new RuleError('BAD_TOKEN', 'Export link is invalid.', 401);
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new RuleError('BAD_TOKEN', 'Export link is invalid.', 401);
  }
  const [encoded, sig] = parts;
  if (!encoded || !/^[0-9a-f]{64}$/i.test(sig)) {
    throw new RuleError('BAD_TOKEN', 'Export link is invalid.', 401);
  }
  const key = await hmacSha256(encoder.encode('ExportLink'), botToken);
  const expectedSig = toHex(await hmacSha256(key, encoded));
  if (!constantTimeEqual(expectedSig, sig.toLowerCase())) {
    throw new RuleError('BAD_TOKEN', 'Export link is invalid.', 401);
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(encoded));
  } catch {
    throw new RuleError('BAD_TOKEN', 'Export link is invalid.', 401);
  }

  if (
    !payload ||
    typeof payload.tgId !== 'string' ||
    !payload.tgId ||
    typeof payload.dept !== 'string' ||
    !payload.dept ||
    !Number.isInteger(payload.workYear) ||
    !Number.isFinite(payload.exp)
  ) {
    throw new RuleError('BAD_TOKEN', 'Export link is invalid.', 401);
  }

  if (nowSec > payload.exp) {
    throw new RuleError('EXPIRED_TOKEN', 'Export link has expired. Tap Export CSV again.', 401);
  }

  return {
    tgId: payload.tgId,
    dept: payload.dept,
    workYear: payload.workYear,
    exp: payload.exp,
  };
}

export async function verifyInitData(initData, botToken, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 86400) {
  if (!initData || typeof initData !== 'string' || !botToken || typeof botToken !== 'string') {
    throw authFail();
  }

  const fields = {};
  let hash = '';
  for (const part of initData.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    let value;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      throw authFail();
    }
    if (key === 'hash') {
      hash = value;
    } else {
      fields[key] = value;
    }
  }

  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw authFail();
  }

  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const signature = toHex(await hmacSha256(secretKey, dataCheckString));

  if (!constantTimeEqual(signature, hash.toLowerCase())) {
    throw authFail();
  }

  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate) || authDate <= 0 || nowSec - authDate > maxAgeSec) {
    throw authFail();
  }

  let user;
  try {
    user = JSON.parse(fields.user);
  } catch {
    throw authFail();
  }

  if (!user || !user.id) {
    throw authFail();
  }

  return {
    id: String(user.id),
    username: user.username ? String(user.username) : '',
    firstName: user.first_name ? String(user.first_name) : '',
  };
}
