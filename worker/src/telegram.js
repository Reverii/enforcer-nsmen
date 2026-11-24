// Sends Telegram bot DMs asynchronously via ctx.waitUntil.
// Delivery failures never fail the user's request; they are recorded in the log table.

import { writeLog } from './db.js';

export async function sendTelegramMessage({ botToken, chatId, text, openUrl, fetchImpl = fetch }) {
  if (!botToken || !chatId) return { ok: false, reason: 'missing_config' };
  const payload = {
    chat_id: String(chatId),
    text: String(text),
  };
  if (openUrl) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: 'Open Enforcer NSMEN', web_app: { url: openUrl } }]],
    };
  }
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => null);
    if (!data || data.ok !== true) return { ok: false, description: data && data.description };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message };
  }
}

export function notifyInBackground({
  ctx,
  db,
  botToken,
  recipients,
  text,
  openUrl = '',
  nowIso,
  fetchImpl = fetch,
}) {
  if (!recipients || !recipients.length) return;
  const work = Promise.all(
    recipients.map(async (r) => {
      const result = await sendTelegramMessage({
        botToken,
        chatId: r.tgId,
        text,
        openUrl,
        fetchImpl,
      });
      if (!result.ok) {
        const who = r.label || r.tgId;
        await writeLog(db, {
          at: nowIso,
          actor: 'bot',
          action: 'dm_failed',
          detail: `message to ${who} not delivered`,
        }).catch(() => {});
      }
    }),
  );

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(work);
  }
}
