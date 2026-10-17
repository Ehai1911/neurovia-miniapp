import { supabase } from './_lib/supabase';
import { getOrCreateUser, getActiveEnrollment, displayName } from './_lib/db';
import { sendWithApp } from './_lib/bot';

// Единый эндпоинт бота (экономим лимит функций Vercel):
//  • POST  — приём апдейтов Telegram (webhook): /start и видеоотзывы.
//  • GET ?action=… — отключено (403): настройка бота делается скриптами на сервере.
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

export default async function handler(req: any, res: any) {
  try {
    if (!TOKEN) return res.status(500).json({ ok: false, error: 'BOT_TOKEN not set' });

    const action = req.query?.action ? String(req.query.action) : '';

    // Сервисные GET-действия убраны: настройка бота (вебхук, меню) — скриптами на сервере.
    if (action) return res.status(403).json({ ok: false, error: "disabled" });

    // ---------- Приём апдейтов Telegram ----------
    if (req.method !== 'POST') return res.status(200).json({ ok: true, note: 'tg webhook alive' });


    // Проверка секрета вебхука (Telegram шлёт заголовок).
    const secret = await getSetting('tg_webhook_secret');
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return res.status(401).json({ ok: false, error: 'bad secret' });
    }

    const update = req.body || {};

    // Посты каналов боту Спринта не нужны: ссылки под постами канала клуба — забота клуб-бота.
    if (update.channel_post) return res.status(200).json({ ok: true });

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
      if (/\bvideo\b/.test(text)) {
        await sendWithApp(chatId, 'Отлично! Прикрепите сюда ваш видеоотзыв 🎥 — просто отправьте видео в этот чат, и мы его получим.', base);
      } else {
        // Кнопка-клавиатура (keyboard + web_app) открывает мини-апп БЕЗ initData — пользователь не определяется.
        // Поэтому: убираем старую клавиатуру и даём кнопку в самом сообщении (inline web_app передаёт initData).
        await tg('sendMessage', {
          chat_id: chatId,
          text: 'Здравствуйте! Добро пожаловать на интенсив «Neurovia Sprint — От интереса к оплате» 🚀\n\nЗдесь всё, что нужно для участия: расписание живых встреч, ссылки на Zoom, задания и отметка посещения.',
          reply_markup: { remove_keyboard: true },
        });
        await sendWithApp(chatId, 'Открывайте кнопкой ниже 👇 или кнопкой «Меню» слева от поля ввода.', base);
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
