# Формат экспорта подписок NEXUS (мобильная ↔ десктопная версия)

Единый JSON-формат для обмена подписками и профилями между NEXUS Mobile
и десктопным NEXUS.

## Схема

```json
{
  "format": "nexus-subscriptions",
  "version": 1,
  "subscriptions": [
    {
      "id": "uuid",
      "url": "https://sub.provider.net/link",
      "title": "Мой провайдер",
      "updateHours": 12,
      "lastSync": "2026-08-20T10:00:00.000Z",
      "expiresAt": "2026-09-20T10:00:00.000Z",
      "upload": 123456,
      "download": 654321,
      "enabled": true,
      "profiles": [
        {
          "id": "uuid",
          "name": "Франкфурт",
          "protocol": "vless",
          "address": "de1.example.com",
          "port": 443,
          "extra": { "uuid": "…", "security": "reality", "sni": "…" },
          "subscriptionId": "uuid",
          "rawLink": "vless://…"
        }
      ]
    }
  ]
}
```

## Поля

| Поле | Тип | Описание |
| --- | --- | --- |
| `format` | string | всегда `nexus-subscriptions` |
| `version` | int | версия схемы |
| `subscriptions[]` | array | список подписок |
| `url` | string | HTTPS-ссылка подписки |
| `title` | string | название |
| `updateHours` | int | интервал автообновления (1–24) |
| `lastSync` / `expiresAt` | ISO8601 \| null | время |
| `upload` / `download` | int | байты трафика |
| `profiles[]` | array | серверы подписки |
| `protocol` | string | `vless` \| `vmess` \| `trojan` \| `shadowsocks` \| `hysteria2` |
| `extra` | object | поля протокола (uuid, password, sni, security…) |
| `rawLink` | string \| null | исходная ссылка импорта |

## Совместимость с десктопом

- Мобильная версия пишет и читает этот формат как есть.
- Десктопный NEXUS хранит подписки в `modules/configs/vpn/`; для обмена
  достаточно привести их к этой же схеме (`format`/`version` сверху —
  необязательные для десктопа, он их игнорирует).
- Парсер мобильной версии принимает и списки ссылок, и Clash YAML —
  при импорте через JSON достаточно массива `subscriptions`.
