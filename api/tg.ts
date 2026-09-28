import { supabase } from './_lib/supabase';
import { getOrCreateUser, getActiveEnrollment, displayName } from './_lib/db';
import { sendWithApp } from './_lib/bot';

// Единый эндпоинт бота (экономим лимит функций Vercel):
//  • POST  — приём апдейтов Telegram (webhook): /start и видеоотзывы.
//  • GET ?action=… — сервисные действия настройки (только при ALLOW_DEV_AUTH=1).
// Видео от студента → копируется в приватный канал «Видеоотзывы» + запись в БД.

const TOKEN = process.env.BOT_TOKEN || '';

async function tg(method: string, payload?: any) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  return r.json();
}

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(key: string, value: string) {
  await supabase.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
}

export default async function handler(req: any, res: any) {
  try {
    if (!TOKEN) return res.status(500).json({ ok: false, error: 'BOT_TOKEN not set' });

    // ---------- Сервисные действия (dev) ----------
    const action = req.query?.action ? String(req.query.action) : '';
    if (action) {
      if (process.env.ALLOW_DEV_AUTH !== '1') return res.status(403).json({ ok: false, error: 'disabled' });
      const host = req.headers['x-forwarded-host'] || req.headers['host'];
      const base = `https://${host}`;
      if (action === 'getwebhookinfo') return res.status(200).json(await tg('getWebhookInfo'));
      if (action === 'deletewebhook') return res.status(200).json(await tg('deleteWebhook', {}));
      if (action === 'getupdates') return res.status(200).json(await tg('getUpdates', { allowed_updates: ['message', 'channel_post', 'my_chat_member'] }));
      if (action === 'getchannel') return res.status(200).json({ ok: true, review_channel_id: await getSetting('review_channel_id') });
      if (action === 'setchannel') {
        const id = String(req.query.id || '');
        if (!id) return res.status(400).json({ ok: false, error: 'id required' });
        await setSetting('review_channel_id', id);
        return res.status(200).json({ ok: true, review_channel_id: id });
      }
      if (action === 'getme') return res.status(200).json(await tg('getMe'));
      if (action === 'setcommands') {
        return res.status(200).json(await tg('setMyCommands', { commands: [{ command: 'kabinet', description: 'Кабинет куратора' }] }));
      }
      if (action === 'testpost') {
        const id = await getSetting('review_channel_id');
        if (!id) return res.status(400).json({ ok: false, error: 'review_channel_id not set' });
        return res.status(200).json(await tg('sendMessage', { chat_id: id, text: '✅ Тест: бот может писать в канал «Видеоотзывы».' }));
      }
      if (action === 'postmenu' || action === 'editmenu') {
        const channel = String(req.query.channel || (await getSetting('main_channel_id')) || '@prorostonline');
        const appLink = 'https://t.me/neurovia_sprint_bot?startapp';
        const botLink = 'https://t.me/neurovia_sprint_bot';
        const shopReady = (await getSetting('shop_ready')) === '1';
        const shop = String(req.query.shop || (await getSetting('shop_url')) || (await getSetting('shop_soon_url')) || 'https://t.me/neurovia_sprint_bot');
        const shopBtn = shopReady
          ? { text: '🛍 Магазин', url: shop }
          : { text: '🛍 Магазин (скоро)', url: shop };
        const vlink = (n: number) => 'https://t.me/c/3268173530/' + n;
        const text = '📌 Меню\n\nВыбирайте по кнопкам ниже 👇';
        const keyboard = {
          inline_keyboard: [
            [{ text: '🎬 Смотреть видео', url: vlink(18) }],
            [shopBtn],
            [{ text: '💬 Поддержка', url: botLink }],
          ],
        };
        if (action === 'editmenu') {
          const mid = Number(req.query.message_id || (await getSetting('main_channel_menu_msg')) || 0);
          if (!mid) return res.status(400).json({ ok: false, error: 'message_id not known' });
          const edited = await tg('editMessageText', { chat_id: channel, message_id: mid, text, reply_markup: keyboard });
          return res.status(200).json({ ok: !!edited?.ok, edited });
        }
        const sent = await tg('sendMessage', { chat_id: channel, text, reply_markup: keyboard });
        let pinned: any = null;
        const mid = sent?.result?.message_id;
        if (sent?.ok && mid) {
          pinned = await tg('pinChatMessage', { chat_id: channel, message_id: mid, disable_notification: true });
          await setSetting('main_channel_id', channel);
          await setSetting('main_channel_menu_msg', String(mid));
        }
        return res.status(200).json({ ok: !!sent?.ok, sent, pinned });
      }
      if (action === 'setsetting') {
        const key = String(req.query.key || '');
        const value = String(req.query.value || '');
        if (!key) return res.status(400).json({ ok: false, error: 'key required' });
        await setSetting(key, value);
        return res.status(200).json({ ok: true, key, value });
      }
      if (action === 'getsetting') {
        const key = String(req.query.key || '');
        return res.status(200).json({ ok: true, key, value: await getSetting(key) });
      }
      if (action === 'setmenubutton') {
        const url = String(req.query.url || base + '/');
        const btnText = String(req.query.text || '🎓 Обучение');
        return res.status(200).json(await tg('setChatMenuButton', {
          menu_button: { type: 'web_app', text: btnText, web_app: { url } },
        }));
      }
      if (action === 'learnpost') {
        const channel = String(req.query.channel || (await getSetting('main_channel_id')) || '@prorostonline');
        const appLink = 'https://t.me/neurovia_sprint_bot?startapp';
        const sent = await tg('sendMessage', {
          chat_id: channel,
          text: '🎓 Обучение — интенсив «От интереса к оплате»\n\n3 дня практики: как довести клиента от первого касания до оплаты. Расписание, задания и бонусы — внутри.\n\nОткрывай кнопкой ниже 👇',
          reply_markup: { inline_keyboard: [[{ text: '🎓 Открыть обучение', url: appLink }]] },
        });
        let pinned: any = null;
        const mid = sent?.result?.message_id;
        if (sent?.ok && mid) {
          pinned = await tg('pinChatMessage', { chat_id: channel, message_id: mid, disable_notification: true });
          await setSetting('learn_post_msg', String(mid));
        }
        return res.status(200).json({ ok: !!sent?.ok, message_id: mid, sent, pinned });
      }
      if (action === 'shopsoon') {
        const channel = String(req.query.channel || (await getSetting('main_channel_id')) || '@prorostonline');
        const sent = await tg('sendMessage', {
          chat_id: channel,
          text: '🛍 Магазин материалов\n\nОткрытие совсем скоро 🔜\nСледите за анонсами в канале.',
        });
        const mid = sent?.result?.message_id;
        if (sent?.ok && mid) await setSetting('shop_soon_url', 'https://t.me/c/3268173530/' + mid);
        return res.status(200).json({ ok: !!sent?.ok, message_id: mid, sent });
      }
      if (action === 'deletepost') {
        const channel = String(req.query.channel || (await getSetting('main_channel_id')) || '@prorostonline');
        const mid = Number(req.query.message_id || 0);
        if (!mid) return res.status(400).json({ ok: false, error: 'message_id required' });
        return res.status(200).json(await tg('deleteMessage', { chat_id: channel, message_id: mid }));
      }
      if (action === 'videoindex') {
        const channel = String(req.query.channel || (await getSetting('main_channel_id')) || '@prorostonline');
        const link = (n: number) => 'https://t.me/c/3268173530/' + n;
        const sent = await tg('sendMessage', {
          chat_id: channel,
          text: '📹 Записи встреч\n\nВыбери день 👇',
          reply_markup: {
            inline_keyboard: [[
              { text: '🎬 День 1', url: link(18) },
              { text: '🎬 День 2', url: link(19) },
              { text: '🎬 День 3', url: link(20) },
            ]],
          },
        });
        const mid = sent?.result?.message_id;
        if (sent?.ok && mid) await setSetting('video_index_msg', String(mid));
        return res.status(200).json({ ok: !!sent?.ok, message_id: mid, post: channel + '/' + mid, sent });
      }
      if (action === 'setwebhook') {
        const secret = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 40);
        await setSetting('tg_webhook_secret', secret);
        const url = base + '/api/tg';
        return res.status(200).json(await tg('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'channel_post', 'my_chat_member'] }));
      }
      return res.status(400).json({ ok: false, error: 'unknown action: ' + action });
    }

    // ---------- Приём апдейтов Telegram ----------
    if (req.method !== 'POST') return res.status(200).json({ ok: true, note: 'tg webhook alive' });

    // Проверка секрета вебхука (Telegram шлёт заголовок).
    const secret = await getSetting('tg_webhook_secret');
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return res.status(401).json({ ok: false, error: 'bad secret' });
    }

    const update = req.body || {};
    const msg = update.message;
    if (!msg) return res.status(200).json({ ok: true }); // channel_post и пр. — игнор

    const from = msg.from || {};
    const chatId = msg.chat?.id;
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    const base = 'https://' + host;

    const text = (typeof msg.text === 'string') ? msg.text.trim() : '';

    // /kabinet → кнопка-вход в кабинет куратора (мини-приложение в Telegram)
    if (text.startsWith('/kabinet')) {
      await tg('sendMessage', {
        chat_id: chatId,
        text: '🎛 Кабинет куратора\nОткройте кнопкой ниже и войдите по логину и паролю (потом вход запомнится).',
        reply_markup: { inline_keyboard: [[{ text: '🎛 Открыть кабинет куратора', web_app: { url: base + '/admin.html' } }]] },
      });
      return res.status(200).json({ ok: true });
    }

    // /start → приглашение прислать видео (по deep-link ?start=video) или приветствие
    if (text.startsWith('/start')) {
      if (/\bvideo\b/.test(text)) {
        await sendWithApp(chatId, 'Отлично! Прикрепите сюда ваш видеоотзыв 🎥 — просто отправьте видео в этот чат, и мы его получим.', base);
      } else {
        await tg('sendMessage', {
          chat_id: chatId,
          text: 'Здравствуйте! Добро пожаловать на интенсив «Neurovia Sprint — От интереса к оплате» 🚀\n\nЗдесь всё, что нужно для участия: расписание живых встреч, ссылки на Zoom, задания и отметка посещения.\n\nОткрывайте кнопкой «☰ Меню» внизу 👇',
          reply_markup: {
            keyboard: [[{ text: '☰ Меню', web_app: { url: base + '/' } }]],
            resize_keyboard: true, is_persistent: true,
          },
        });
      }
      return res.status(200).json({ ok: true });
    }

    // Видео (как video или как документ с video/*)
    const video = msg.video || (msg.document && String(msg.document.mime_type || '').startsWith('video/') ? msg.document : null);
    if (video) {
      const user = await getOrCreateUser({ id: from.id, username: from.username, first_name: from.first_name, last_name: from.last_name } as any);
      const enr = await getActiveEnrollment(user.id);
      const name = displayName(user);
      const cohortTitle = enr?.cohort?.title || '—';

      if (enr) {
        await supabase.from('feedback_submissions').upsert({
          enrollment_id: enr.id, kind: 'video', video_url: 'tg:' + (video.file_id || ''),
          submitted_at: new Date().toISOString(),
        }, { onConflict: 'enrollment_id' });
      }

      const channelId = await getSetting('review_channel_id');
      if (channelId) {
        const caption = '🎥 Видеоотзыв\n👤 ' + name + (from.username ? ' (@' + from.username + ')' : '') +
          '\n📚 ' + cohortTitle + '\n🆔 ' + from.id + '\n🕒 ' + new Date().toLocaleString('ru-RU');
        await tg('copyMessage', { chat_id: channelId, from_chat_id: chatId, message_id: msg.message_id, caption });
      }

      await sendWithApp(chatId, 'Спасибо! Видеоотзыв получен ✅ «Бонус за финиш — мини-курс» откроется после проверки куратором.', base);
      return res.status(200).json({ ok: true });
    }

    // Прочие сообщения
    await sendWithApp(chatId, 'Чтобы оставить видеоотзыв — прикрепите видео в этот чат 🎥', base);
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    // Всегда 200 для Telegram, чтобы не было ретраев-штормов; ошибку логируем в ответ.
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
}
