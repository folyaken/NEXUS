# NEXUS — Network Control Plane

Полноценный каркас desktop-приложения на **Electron + React + TypeScript + Vite** для управления локальными сетевыми инструментами.

## Что реализовано

- Тёмный neo/glass UI с неоновыми cyan/violet-акцентами, мягкими тенями и responsive-раскладкой.
- Все UI-анимации выполнены через `@react-spring/web`: появление карточек, hover-lift, toggles, pulse-индикаторы, toast и строки журнала.
- Плагинная система: при старте сканируется `./modules`, подхватываются все `*.module.json`.
- Electron main process с безопасным IPC через `contextBridge`, `contextIsolation: true`, `nodeIntegration: false`.
- Управление жизненным циклом дочерних процессов через `spawn(..., { shell: false })`.
- Перенаправление stdout/stderr в `log_file`, online event stream и PID в карточках модулей.
- Dashboard, реестр модулей, журнал событий и настройки runtime.
- `electron-builder` конфигурация для Windows NSIS и Linux AppImage.
- Кастомная frameless title bar: свернуть, fullscreen (Esc), закрыть в трей или выйти полностью.
- Настройки runtime сохраняются в `userData/settings.json`: автозапуск включённых модулей, уведомления, закрытие в трей.
- При выходе все дочерние процессы останавливаются; второй экземпляр не запускается.
- Локальный профиль: имя пользователя + device key, рассчитанный локально и сохранённый в `userData/profile.json`.
- GitHub-only updater для `Flowseal/zapret-discord-youtube` и `Flowseal/tg-ws-proxy`: latest release API, allowlist asset URL, SHA-256 журнала, автоматическая синхронизация при старте.

## Скачать без лишней папки

Не используй кнопку GitHub «Download ZIP» — там будет обёртка `NEXUS-.../`.

Бери готовый плоский архив `NEXUS.zip` из корня ветки (внутри сразу `package.json`, `src`, `modules`).

## Jey2Ray

Вкладка **Jey2Ray** — VPN-клиент на Xray-core. Вставь `vless://`, `vmess://`, `trojan://` или `ss://`. Ядро качается с `XTLS/Xray-core` в `modules/bin/xray.exe`. Профили лежат в `modules/configs/vpn/`. Локальный SOCKS: `127.0.0.1:10808`.

## Быстрый старт

```bash
npm install
npm run dev
# или standalone-запуск без Vite и порта 5173
npm start
```

Для быстрого просмотра renderer без Electron:

```bash
npm run dev:web
```

Сборка renderer + main:

```bash
npm run build
```

Сборка установщика:

```bash
npm run package
```

## Подключение модуля

1. Положите доверенный исполняемый файл в `modules/bin`.
2. Добавьте рядом файл с расширением `.module.json`.
3. Укажите относительные `executable` и `log_file`.
4. Нажмите «Сканировать заново» в приложении.

Пример:

```json
{
  "id": "my-module",
  "name": "My module",
  "description": "Local network helper",
  "enabled": false,
  "executable": "./bin/my-module.exe",
  "args": ["--listen", "127.0.0.1:8080"],
  "status": "stopped",
  "category": "proxy",
  "icon": "◈",
  "pid": null,
  "log_file": "./logs/my-module.log"
}
```

Относительные пути разрешаются относительно каталога `modules`. NEXUS не включает сторонние бинарные файлы Zapret, TG-WS-Proxy или ExitLag SDK: добавляйте только проверенные версии и сверяйте их происхождение. Встроенные манифесты в репозитории служат безопасными шаблонами интерфейса.

## Структура

```text
src/
  main/
    main.ts              # BrowserWindow, IPC, lifecycle
    module-manager.ts    # scan, spawn, stop, logs
    preload.ts           # typed contextBridge API
    types.ts
  renderer/
    App.tsx              # экран и компоненты интерфейса
    styles.css           # visual system
    main.tsx
modules/
  *.module.json         # plugin manifests
  README.md
```
