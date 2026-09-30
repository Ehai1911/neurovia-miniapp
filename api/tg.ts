import { supabase } from './_lib/supabase';
import { getOrCreateUser, getActiveEnrollment, displayName } from './_lib/db';
import { sendWithApp } from './_lib/bot';
import { getAuthedUser } from './_lib/auth';

const CLUB_TOKEN = process.env.CLUB_BOT_TOKEN || '';
async function clubTg(method: string, payload?: any) {
  const r = await fetch(`https://api.telegram.org/bot${CLUB_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
  });
  return r.json();
}

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

// Единая клавиатура-меню клуба (используется и в закрепе, и под каждым постом).
async function clubMenuKeyboard() {
  const shopReady = (await getSetting('shop_ready')) === '1';
  const shop = (await getSetting('shop_url')) || (await getSetting('shop_soon_url')) || 'https://t.me/neurovia_sprint_bot';
  const chatUrl = (await getSetting('club_chat_url')) || 'https://t.me/+Ev7OzmOXRAhiNGJi';
  return {
    inline_keyboard: [
      [
        { text: '🚀 Точка Роста', url: 'https://t.me/bahitadminbot?startapp=video' },
        { text: '👥 Наш чат', url: chatUrl },
      ],
      [
        shopReady ? { text: '🛍 Магазин', url: shop } : { text: '🛍 Магазин (скоро)', url: shop },
        { text: '💬 Обратная связь', url: 'https://t.me/bahitadminbot?start=support' },
      ],
    ],
  };
}

export default async function handler(req: any, res: any) {
  try {
    if (!TOKEN) return res.status(500).json({ ok: false, error: 'BOT_TOKEN not set' });

    const action = req.query?.action ? String(req.query.action) : '';

    // ---------- ПРОД: проверка членства в закрытом канале (клубный бот) ----------
    // Вызывается из видеотеки (video.html), открытой через @bahitadminbot. НЕ dev-gated.
    if (action === 'clubcheck') {
      if (!CLUB_TOKEN) return res.status(500).json({ ok: false, error: 'CLUB_BOT_TOKEN not set' });
      let user: any;
      try { user = getAuthedUser(req, CLUB_TOKEN); }
      catch (e: any) { return res.status(401).json({ ok: false, error: String(e?.message || e) }); }
      const channel = (await getSetting('main_channel_id')) || '-1003268173530';
      const r = await clubTg('getChatMember', { chat_id: channel, user_id: user.id });
      const st = r?.result?.status;
      const member = st === 'creator' || st === 'administrator' || st === 'member' || (st === 'restricted' && !!r.result?.is_member);
      let videos: any[] = [];
      if (member) { try { videos = JSON.parse((await getSetting('videos')) || '[]'); } catch { videos = []; } }
      return res.status(200).json({ ok: true, member: !!member, videos: member ? videos : [] });
    }

    // ---------- Сервисные действия (dev) ----------
    if (action) {
      if (process.env.ALLOW_DEV_AUTH !== '1') return res.status(403).json({ ok: false, error: 'disabled' });
      if (action === 'clubgetme') return res.status(200).json(await clubTg('getMe'));
      if (action === 'clubmenubutton') {
        if (req.query.reset === '1') {
          return res.status(200).json(await clubTg('setChatMenuButton', { menu_button: { type: 'default' } }));
        }
        const h = req.headers['x-forwarded-host'] || req.headers['host'];
        const url = String(req.query.url || ('https://' + h + '/video.html'));
        const btnText = String(req.query.text || '🚀 Точка Рост');
        return res.status(200).json(await clubTg('setChatMenuButton', {
          menu_button: { type: 'web_app', text: btnText, web_app: { url } },
        }));
      }
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
        const text = '📌 Меню\n\nВыбирайте по кнопкам ниже 👇';
        const keyboard = await clubMenuKeyboard();
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
      if (action === 'addmenubtn') {
        const channel = String(req.query.channel || (await getSetting('main_channel_id')) || '@prorostonline');
        const mid = Number(req.query.message_id || 0);
        if (!mid) return res.status(400).json({ ok: false, error: 'message_id required' });
        return res.status(200).json(await tg('editMessageReplyMarkup', {
          chat_id: channel, message_id: mid, reply_markup: await clubMenuKeyboard(),
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
      if (action === 'clubsetwebhook') {
        const secret = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 40);
        await setSetting('club_webhook_secret', secret);
        const url = base + '/api/tg?bot=club';
        return res.status(200).json(await clubTg('setWebhook', { url, secret_token: secret, allowed_updates: ['message'] }));
      }
      return res.status(400).json({ ok: false, error: 'unknown action: ' + action });
    }

    // ---------- Приём апдейтов Telegram ----------
    if (req.method !== 'POST') return res.status(200).json({ ok: true, note: 'tg webhook alive' });

    // ----- Вебхук КЛУБНОГО бота (@bahitadminbot): видеотека + поддержка -----
    if (req.query?.bot === 'club') {
      const cs = await getSetting('club_webhook_secret');
      if (cs && req.headers['x-telegram-bot-api-secret-token'] !== cs) return res.status(401).json({ ok: false, error: 'bad secret' });
      const u = req.body || {};
      const m = u.message;
      if (!m || !m.chat) return res.status(200).json({ ok: true });
      const t = (typeof m.text === 'string') ? m.text.trim() : '';
      const h = req.headers['x-forwarded-host'] || req.headers['host'];
      const supportGroup = await getSetting('support_group_id');

      // --- В ГРУППЕ поддержки ---
      if (m.chat.type === 'group' || m.chat.type === 'supergroup') {
        // Настройка группы: /setsupport → запомнить эту группу как группу поддержки
        if (t === '/setsupport' || t.startsWith('/setsupport@')) {
          await setSetting('support_group_id', String(m.chat.id));
          await clubTg('sendMessage', { chat_id: m.chat.id, text: '✅ Эта группа теперь — поддержка клуба. Отвечайте reply на вопросы участников.' });
          return res.status(200).json({ ok: true });
        }
        // Ответ куратора: reply на сообщение бота с #id → отправить пользователю
        if (supportGroup && String(m.chat.id) === String(supportGroup) && m.reply_to_message) {
          const src = (m.reply_to_message.text || m.reply_to_message.caption || '');
          const mm = src.match(/#(\d{4,})/);
          const reply = m.text || m.caption || '';
          if (mm && reply) {
            const sent = await clubTg('sendMessage', { chat_id: Number(mm[1]), text: '💬 Ответ от куратора:\n\n' + reply });
            await clubTg('sendMessage', { chat_id: m.chat.id, reply_to_message_id: m.message_id, text: sent?.ok ? '✅ Отправлено участнику.' : '⚠️ Не удалось отправить (участник не открывал бота).' });
          }
        }
        return res.status(200).json({ ok: true });
      }

      // --- ЛИЧКА с ботом ---
      if (m.chat.type === 'private') {
        if (t.startsWith('/start')) {
          if (/\bsupport\b/.test(t)) {
            await clubTg('sendMessage', { chat_id: m.chat.id, text: '💬 Обратная связь клуба «Про Рост Онлайн».\n\nНапишите ваш вопрос прямо сюда — куратор ответит здесь же.' });
          } else {
            await clubTg('sendMessage', {
              chat_id: m.chat.id,
              text: '🚀 Точка Рост — эфиры с экспертами клуба «Про Рост Онлайн».\nОткрывайте кнопкой ниже 👇',
              reply_markup: { inline_keyboard: [[{ text: '🚀 Открыть Точку Рост', web_app: { url: 'https://' + h + '/video.html' } }]] },
            });
          }
          return res.status(200).json({ ok: true });
        }
        // Любое сообщение → в группу поддержки (с пометкой #id для ответа)
        if (supportGroup) {
          const from = m.from || {};
          const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Участник';
          const head = '👤 ' + name + (from.username ? (' (@' + from.username + ')') : '') + ' #' + from.id;
          if (m.text) {
            await clubTg('sendMessage', { chat_id: supportGroup, text: head + '\n\n' + m.text });
          } else {
            await clubTg('copyMessage', { chat_id: supportGroup, from_chat_id: m.chat.id, message_id: m.message_id, caption: head });
          }
          await clubTg('sendMessage', { chat_id: m.chat.id, text: '✅ Ваш вопрос отправлен куратору. Ответ придёт сюда.' });
        } else {
          await clubTg('sendMessage', { chat_id: m.chat.id, text: 'Поддержка скоро будет подключена. Напишите позже 🙏' });
        }
        return res.status(200).json({ ok: true });
      }

      return res.status(200).json({ ok: true });
    }

    // Проверка секрета вебхука (Telegram шлёт заголовок).
    const secret = await getSetting('tg_webhook_secret');
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return res.status(401).json({ ok: false, error: 'bad secret' });
    }

    const update = req.body || {};

    // Авто-кнопки меню (Точка Роста / Наш чат / Магазин / Обратная связь) под каждым новым постом канала.
    const cp = update.channel_post;
    if (cp && cp.chat && cp.message_id) {
      const mainCh = await getSetting('main_channel_id');
      if (mainCh && String(cp.chat.id) === String(mainCh)) {
        const hasBtns = !!(cp.reply_markup && cp.reply_markup.inline_keyboard);
        const isContent = !!(cp.video || cp.photo || cp.document || cp.animation || cp.text || cp.caption);
        const menuMsg = Number(await getSetting('main_channel_menu_msg')) || 0;
        if (!hasBtns && isContent && cp.message_id !== menuMsg) {
          await tg('editMessageReplyMarkup', {
            chat_id: cp.chat.id, message_id: cp.message_id,
            reply_markup: await clubMenuKeyboard(),
          });
        }
      }
      return res.status(200).json({ ok: true });
    }

    const msg = update.message;
    if (!msg) return res.status(200).json({ ok: true }); // прочие апдейты — игнор

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
      if (/\bvideoteka\b/.test(text)) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: '🎬 Видеотека — записи и уроки. Откройте кнопкой ниже 👇',
          reply_markup: { inline_keyboard: [[{ text: '🎬 Открыть видеотеку', web_app: { url: base + '/video.html' } }]] },
        });
      } else if (/\bvideo\b/.test(text)) {
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
