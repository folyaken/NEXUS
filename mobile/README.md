# NEXUS Mobile

Кроссплатформенный мобильный аналог десктопного NEXUS на **Flutter (Dart)**
для Android и iOS.

Тёмная неоморфная тема, неоновые акценты, нижняя навигация
(Панель · Модули · Jey2Ray · Настройки) и те же сценарии, что на десктопе:
обход DPI, TG WS Proxy и VPN-клиент Jey2Ray.

---

## ⚡ Статус и важное предупреждение

Проект написан в среде **без установленного Flutter SDK**, поэтому:

- весь **Dart-код приложения** (`lib/`) готов и структурирован;
- **VPN-движок по умолчанию — мок** (`MockVpnEngine`): приложение запускается
  и демонстрирует весь интерфейс (подключение, пинг, статусы) без нативных
  зависимостей;
- **реальный туннель** (sing-box / Xray-core через `flutter_v2ray_plus` или
  `v2ray_box`) подключается отдельно — см. «Реальный VPN-движок» ниже.

Перед первым запуском выполните:

```bash
cd mobile
flutter create . --platforms=android,ios   # генерирует полный android/ + ios/
flutter pub get
flutter run
```

`flutter create .` догенерирует недостающие платформенные файлы (Gradle wrapper,
Xcode project и т.д.). Предоставленные в этом репозитории `android/` и `ios/`
файлы — целевые (манифест, minSdk 23, VpnService, Info.plist, entitlements).

---

## 🧭 Соответствие требованиям

| Требование | Реализация |
| --- | --- |
| Тёмная тема + неон (cyan `#00D4AA`, violet `#6C63FF`) | `lib/core/theme.dart` |
| Неоморфизм (двойные тени) | `lib/widgets/neu_card.dart` (`Neu.card` / `Neu.inset`) |
| Анимации | `AnimatedContainer`, `AnimatedSwitcher`, `NeonToggle`, `PulseDot` |
| Нижняя навигация | `lib/screens/home_shell.dart` |
| Модуль «Обход DPI» + список сайтов | `ModuleManager` + `ModulesScreen` |
| Модуль «TG WS Proxy» | `ModuleManager` (foreground service — `NexusVpnService`) |
| Jey2Ray: VLESS/VMess/Trojan/SS/Hysteria2 | `lib/services/profile_parser.dart` |
| Импорт ссылок + QR | `Jey2RayScreen` + `QrScanScreen` (mobile_scanner) |
| Подписки: HTTPS, автообновление, удаление | `lib/services/subscription_manager.dart` |
| Режимы PROXY / TUN | переключатель в `Jey2RayScreen` |
| Пинг до сервера | `VpnEngine.ping` |
| SharedPreferences + SQLite | `lib/services/storage_service.dart` |
| Dio + кэш подписок | `dio` + `dio_cache_interceptor` (в pubspec) |
| AES-256 для токенов | `lib/core/security.dart` |
| RU + EN локализация | `lib/core/l10n.dart` |
| Журнал | `lib/core/logger.dart` + `LogsScreen` |
| Экспорт/импорт JSON (совместимо с десктопом) | `SubscriptionManager.exportJson/importJson` + `doc/NEXUS_EXPORT_SCHEMA.md` |
| Android minSdk 23 | `android/app/build.gradle` |
| iOS 12+ | `ios/Podfile` (`platform :ios, '12.0'`) |

---

## 📁 Структура

```
mobile/
├── lib/
│   ├── main.dart                 # точка входа
│   ├── app.dart                  # провайдеры + тема + локализация
│   ├── core/
│   │   ├── theme.dart            # палитра, неоморфизм, тема
│   │   ├── constants.dart        # протоколы, DNS-пресеты, сайты
│   │   ├── l10n.dart             # RU/EN словари
│   │   ├── security.dart         # AES-256-CBC
│   │   └── logger.dart           # журнал (память + SharedPreferences)
│   ├── models/                   # профиль, подписка, модуль, настройки, лог
│   ├── services/
│   │   ├── vpn_engine.dart       # абстракция движка + фабрика
│   │   ├── vpn_engine_mock.dart  # демо-движок
│   │   ├── profile_parser.dart   # vless/vmess/trojan/ss/hy2 + base64/Clash
│   │   ├── subscription_manager.dart
│   │   ├── module_manager.dart
│   │   └── storage_service.dart  # SharedPreferences + SQLite
│   ├── state/settings_controller.dart
│   ├── screens/                  # home_shell, dashboard, modules,
│   │                             # jey2ray, settings, logs, subscriptions,
│   │                             # add_subscription, qr_scan
│   └── widgets/                  # neu_card, neon_toggle, pulse_dot,
│                                 # stat_card, module_card, power_orb
├── doc/
│   ├── vpn_engine_v2ray.example.dart   # пример реального движка
│   └── NEXUS_EXPORT_SCHEMA.md          # JSON-схема подписок
├── android/                      # манифест, minSdk 23, VpnService, MainActivity
└── ios/                          # Info.plist, entitlements, PacketTunnelProvider, Podfile
```

---

## 🔌 Реальный VPN-движок

1. Добавьте плагин в `pubspec.yaml` (выберите один, сверьте версию на pub.dev):
   ```yaml
   dependencies:
     flutter_v2ray_plus: ^<версия>   # или v2ray_box
   ```
2. Скопируйте `doc/vpn_engine_v2ray.example.dart` →
   `lib/services/vpn_engine_v2ray.dart` и уточните вызовы под API плагина.
3. В `lib/services/vpn_engine.dart` верните реальную реализацию:
   ```dart
   static VpnEngine create() => V2rayEngine();
   ```
4. Нативные ядра (`sing-box` / `xray`):
   - **Android**: бинарники кладутся в `android/app/src/main/jniLibs/<abi>/`
     (или поставляются самим плагином);
   - **iOS**: ядро собирается как статическая библиотека внутри Network
     Extension target (`NexusTunnel`).

Требования операционок уже учтены в конфигах:
- Android: `VpnService` + foreground service (`NexusVpnService.kt`);
- iOS: `NexusPacketTunnelProvider.swift` + entitlements
  `com.apple.developer.networking.vpn.api` и
  `com.apple.developer.networking.networkextension`.

> TG WS Proxy: нативный `tg-ws-proxy-android` запускается как foreground service —
> в демо-режиме модуль просто переключает статус (`ModuleManager`).

---

## 🔐 Безопасность

- Токены/ссылки подписок шифруются **AES-256-CBC** (`lib/core/security.dart`);
- ключ (SHA-256) хранится локально в `SharedPreferences`;
- для мобильных релизов секрет ключа рекомендуется перенести в защищённое
  хранилище ОС (Keychain / Android Keystore) через плагин `flutter_secure_storage`
  (из зависимостей он исключён, т.к. его Windows-сборка требует компонент ATL
  из Visual Studio — см. ниже);
- профили и подписки — в локальной SQLite (на мобильных) или в памяти
  (на десктопе), ничего не уходит в облако.

> Если сборка Windows падает с ошибкой `atlstr.h: No such file or directory` —
> это компонент ATL из Visual Studio. Решения:
> 1) в Visual Studio Installer → изменить → «Разработка классических приложений
>    на C++» → «Библиотека ATL для новейших инструментов сборки»; либо
> 2) не использовать плагины, требующие ATL (как `flutter_secure_storage`,
>    уже исключён из этого проекта).

---

## 🧪 Что уже работает без нативных зависимостей

- Полная навигация и все экраны;
- добавление профилей по ссылке (`vless://`, `vmess://`, `trojan://`, `ss://`, `hy2://`);
- QR-сканирование;
- подписки (добавление, обновление, удаление) с парсингом base64 и Clash YAML;
- экспорт/импорт JSON;
- переключение языка, DNS, интервалы обновления;
- журнал событий;
- демо-подключение VPN, пинг и статусы.

## ⏳ Требует нативного окружения

- реальный туннель (плагин + ядро);
- TG WS Proxy (нативный бинарник);
- финальная подпись iOS (Apple Developer) для Network Extension.
