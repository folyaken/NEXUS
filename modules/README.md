# NEXUS modules

Положите исполняемые файлы и связанные конфигурации в `modules/bin`, затем запустите NEXUS.

Каждый файл `*.module.json` — манифест модуля. Относительные пути `executable` и `log_file` разрешаются относительно этой папки.

NEXUS запускает процессы без shell (`shell: false`), прокидывает stdout/stderr в `log_file` и завершает дочерний процесс через IPC. Используйте только доверенные бинарные файлы и проверяйте их происхождение.

Минимальная схема:

```json
{
  "id": "my-module",
  "name": "My module",
  "description": "Local network helper",
  "enabled": false,
  "executable": "./bin/my-module.exe",
  "args": [],
  "status": "stopped",
  "category": "other",
  "icon": "◈",
  "pid": null,
  "log_file": "./logs/my-module.log",
  "working_dir": "./bin"
}
```
