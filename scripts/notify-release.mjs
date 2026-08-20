#!/usr/bin/env node
/**
 * Отправляет пост в Telegram при публикации релиза GitHub.
 * Запускается из .github/workflows/release-announce.yml
 *
 * Требуемые секреты репозитория:
 *   TELEGRAM_BOT_TOKEN  — токен бота от @BotFather
 *   TELEGRAM_CHAT_ID    — @username канала или числовой id чата
 *   TELEGRAM_MESSAGE_THREAD_ID (необязательно) — id темы форума
 */
import fs from 'node:fs';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
const chatId = process.env.TELEGRAM_CHAT_ID || '';
const threadId = process.env.TELEGRAM_MESSAGE_THREAD_ID || '';
const eventPath = process.env.GITHUB_EVENT_PATH || '';

if (!token || !chatId) {
  console.error('Ошибка: не заданы секреты TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID.');
  process.exit(1);
}

let event = {};
try {
  event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
} catch {
  /* событие недоступно — продолжим с пустым */
}

const repo = event.repository?.full_name || process.env.GITHUB_REPOSITORY || 'NEXUS';
const release = event.release;
const inputs = event.inputs || {};

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

let title;
let changes;
let link;

if (release) {
  // Автоматический запуск по событию release
  const tag = release.tag_name || 'новая версия';
  title = release.name && release.name !== release.tag_name
    ? `${release.name} · ${release.tag_name}`
    : tag;
  changes = (release.body || '').trim();
  link = release.html_url;
} else {
  // Ручной запуск (workflow_dispatch) — для хотфиксов без релиза
  title = inputs.title || 'новая версия';
  changes = inputs.body || '';
  link = `https://github.com/${repo}/releases`;
}

const emoji = release?.prerelease ? '🧪' : '🔄';
const changesLines = changes ? changes.split('\n').slice(0, 18) : [];

const lines = [`${emoji} <b>Обновление ${escapeHtml(title)}</b>`, ''];
if (changesLines.length) {
  lines.push('<b>Изменения:</b>', escapeHtml(changesLines.join('\n')), '');
}
lines.push(`🔗 <a href="${link}">Скачать / все релизы</a>`);
lines.push('', '#NEXUS #Update');

let text = lines.join('\n');
if (text.length > 3900) text = text.slice(0, 3900) + '…';

console.log('Отправляю в Telegram:\n' + text + '\n---');

const payload = {
  chat_id: chatId,
  text,
  parse_mode: 'HTML',
  disable_web_page_preview: false,
};
if (threadId) payload.message_thread_id = Number(threadId);

const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});
const data = await resp.json();
if (!resp.ok) {
  console.error('Ошибка Telegram API:', JSON.stringify(data, null, 2));
  process.exit(1);
}
console.log('Готово, message_id =', data.result?.message_id);
