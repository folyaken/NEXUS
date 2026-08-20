# Авто-пост в Telegram при публикации релиза

Публикуешь релиз на GitHub → GitHub Actions сам отправляет пост в Telegram.
Свой сервер не нужен, для публичных репозиториев это бесплатно.

## Как это работает

1. В репозитории, где лежат релизы (`NEXUS-releases`), находится workflow
   `.github/workflows/release-announce.yml` (содержимое ниже).
2. Событие `release: published` запускает его при каждой новой публикации.
3. Скрипт `scripts/notify-release.mjs` берёт название версии и описание релиза
   и отправляет сообщение через Telegram Bot API.

Пример поста:

```
🔄 Обновление v1.3.1

Изменения:
— починили X
— добавили Y

🔗 Скачать / все релизы

#NEXUS #Update
```

Хотфикс без релиза: Actions → «Telegram — анонс релиза» → **Run workflow**,
укажи заголовок и изменения — пост придёт вручную.

---

## Настройка (один раз)

### 1. Создать бота

1. Открой в Telegram @BotFather.
2. `/newbot` → имя (например, `NEXUS Releases`) → username (например, `nexus_releases_bot`).
3. Скопируй **токен** (выглядит как `123456789:AAH...`).

### 2. Создать канал (или взять группу)

1. Создай канал (лучше **публичный** — у него есть `@username`).
2. Добавь бота в канал и сделай его **администратором** (право «Публиковать сообщения»).
   - Для группы: добавь бота участником (и админом, если будешь постить в темы форума).

### 3. Узнать chat_id

- **Публичный канал/группа:** просто `@username` (например, `@nexus_releases`).
- **Приватный канал/группа:** добавь бота @RawDataBot в чат, он пришлёт `chat_id`
  (число вида `-1001234567890`). Потом бота можно удалить.

### 4. Добавить секреты в репозиторий релизов

В `NEXUS-releases` → **Settings → Secrets and variables → Actions → New repository secret**:

| Имя секрета | Значение |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | токен бота |
| `TELEGRAM_CHAT_ID` | `@username` канала или числовой id |
| `TELEGRAM_MESSAGE_THREAD_ID` | *(необязательно)* id темы форума, если постишь в тему |

### 5. Положить два файла в репозиторий релизов

В репозитории `NEXUS-releases` создай:

1. Файл **`scripts/notify-release.mjs`** — скопируй из `scripts/notify-release.mjs`
   этого репозитория (или из `/scripts` в клоне NEXUS).
2. Файл **`.github/workflows/release-announce.yml`** — со следующим содержимым:

```yaml
name: Telegram — анонс релиза

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      title:
        description: 'Заголовок поста (например: v1.3.1 или Хотфикс)'
        required: false
      body:
        description: 'Что изменилось (по строкам)'
        required: false

permissions:
  contents: read

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Отправить пост в Telegram
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
          TELEGRAM_MESSAGE_THREAD_ID: ${{ secrets.TELEGRAM_MESSAGE_THREAD_ID }}
        run: node scripts/notify-release.mjs
```

> ⚠️ Файл `.github/workflows/*.yml` нельзя запушить токеном с ограниченными
> правами (GitHub блокирует создание workflow без разрешения `workflows`) —
> поэтому он создаётся вручную через веб-интерфейс GitHub:
> **Add file → Create new file** → путь `.github/workflows/release-announce.yml`
> → вставить содержимое выше → Commit.

### 6. Проверить

- Вариант А: опубликуй релиз (`releases/new` → Publish) — пост придёт автоматически.
- Вариант Б: Actions → workflow → **Run workflow** (без релиза) — проверка вручную.

---

## Заметки

- **HTML-форматирование** в посте включено; описание релиза экранируется, чтобы
  случайные `<`/`>` не ломали разметку.
- Длинное описание обрезается до 18 строк (лимит Telegram — 4096 символов).
- Предрелиз (`prerelease: true`) публикуется с пометкой 🧪.
- Workflow отрабатывает за пару секунд; лимиты Actions для публичного репозитория
  здесь не ощутимы.
- Если релизы лежат не в `NEXUS-releases`, а в другом репозитории — клади workflow
  именно туда, где публикуешь релизы.
