// Общие помощники Telegram-бота: вызов API и отправка с кнопкой «Открыть спринт».
const TOKEN = process.env.BOT_TOKEN || '';

export async function tgCall(method: string, payload?: any) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return r.json();
}

// Клавиатура: сначала доп. кнопки (напр. Zoom), затем всегда «🚀 Открыть спринт» (мини-апп).
export function appKeyboard(base: string, extraRows?: any[]) {
  const rows: any[] = [];
  if (extraRows && extraRows.length) rows.push(...extraRows);
  rows.push([{ text: '🚀 Открыть спринт', web_app: { url: base + '/' } }]);
  return { inline_keyboard: rows };
}

// Отправить сообщение с кнопкой приложения (и опц. доп. кнопками).
export async function sendWithApp(chatId: number | string, text: string, base: string, extraRows?: any[]) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: appKeyboard(base, extraRows),
  });
}
