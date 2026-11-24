// Test helper: signs Telegram Mini App initData identically to Telegram.
import crypto from 'node:crypto';

export function signInitData(fields, botToken) {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return (
    Object.keys(fields)
      .map((k) => `${k}=${encodeURIComponent(fields[k])}`)
      .join('&') +
    `&hash=${hash}`
  );
}

export function initDataFor(user, botToken, authDate = Math.floor(Date.now() / 1000)) {
  return signInitData(
    {
      query_id: `AAH${user.id}`,
      user: JSON.stringify(user),
      auth_date: String(authDate),
    },
    botToken,
  );
}
