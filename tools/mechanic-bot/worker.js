// EV8 — посредник Telegram → Google Apps Script (Cloudflare Worker).
// Telegram сразу получает «200 OK», а сообщение уходит в Apps Script в фоне.
// Без него Google отвечает Telegram редиректом 302 и очередь сообщений застревает.

// ▼ Вставьте сюда Web app URL из Apps Script (заканчивается на /exec)
const GAS_URL = 'https://script.google.com/macros/s/ВСТАВЬТЕ_СЮДА/exec';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('EV8 bot proxy: ok');
    const body = await request.text();
    ctx.waitUntil(
      fetch(GAS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        redirect: 'follow',
      }).catch((err) => console.log('forward failed', err))
    );
    return new Response('ok');
  },
};
