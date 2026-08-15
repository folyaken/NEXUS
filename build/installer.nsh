; Дополнения к установщику NSIS.
;
; Решают две задачи, которые electron-builder сам не закрывает:
;   1. Останавливают процессы, запущенные приложением, — иначе после удаления
;      winws.exe и TgWsProxy.exe продолжают работать в памяти, а файлы модулей
;      остаются занятыми и не удаляются.
;   2. Возвращают системный прокси Windows в исходное состояние. Это самое
;      важное: NEXUS включает прокси на время работы VPN, и если удалить
;      программу с активным подключением, в системе останется указатель на
;      несуществующий локальный прокси — пользователь просто потеряет интернет
;      и не поймёт причину.

; --- Остановка процессов, которыми управляет приложение ----------------------
!macro stopNexusWorkers
  DetailPrint "Остановка сетевых модулей..."

  ; Ядра VPN и модули обхода блокировок.
  nsExec::Exec 'taskkill /F /T /IM "winws.exe"'
  nsExec::Exec 'taskkill /F /T /IM "xray.exe"'
  nsExec::Exec 'taskkill /F /T /IM "sing-box.exe"'

  ; Сборки TG WS Proxy отличаются именем в зависимости от разрядности,
  ; поэтому перечисляются все варианты, которые может скачать приложение.
  nsExec::Exec 'taskkill /F /T /IM "TgWsProxy_windows_7_64bit.exe"'
  nsExec::Exec 'taskkill /F /T /IM "TgWsProxy_windows_7_32bit.exe"'
  nsExec::Exec 'taskkill /F /T /IM "TgWsProxy_windows_arm64.exe"'
  nsExec::Exec 'taskkill /F /T /IM "TgWsProxy_windows.exe"'

  ; Службе WinDivert, которую поднимает Zapret, нужно время на освобождение
  ; драйвера — иначе следующая установка столкнётся с занятым файлом.
  Sleep 700
!macroend

; --- Возврат системного прокси в исходное состояние --------------------------
!macro restoreSystemProxy
  DetailPrint "Восстановление сетевых настроек Windows..."

  ; Прокси включается в ветке текущего пользователя (HKCU). Установщик работает
  ; с правами администратора, поэтому запись выполняется от имени пользователя,
  ; запустившего удаление.
  SetShellVarContext current
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyEnable" 0
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Internet Settings" "ProxyServer"

  ; Без уведомления система продолжит использовать прежние настройки до
  ; перезагрузки: значения 39 и 37 заставляют Windows перечитать конфигурацию.
  nsExec::Exec 'rundll32.exe wininet.dll,InternetSetOption 0 39 0 0'
  nsExec::Exec 'rundll32.exe wininet.dll,InternetSetOption 0 37 0 0'
!macroend

; --- Перед установкой --------------------------------------------------------
; Обновление поверх работающей копии иначе упирается в занятые файлы.
!macro customInit
  !insertmacro stopNexusWorkers
!macroend

; --- Перед удалением ---------------------------------------------------------
!macro customUnInit
  !insertmacro stopNexusWorkers
  !insertmacro restoreSystemProxy
!macroend

; --- Удаление пользовательских данных ---------------------------------------
; Настройки, профили VPN и список сайтов по умолчанию сохраняются: при
; переустановке пользователь ожидает найти их на месте. Удаление предлагается
; отдельным вопросом, а не выполняется молча.
!macro customUnInstall
  ; Метки NSIS глобальны на весь скрипт, а этот макрос подставляется в уже
  ; сгенерированный installer.nsi — метки внутри условия ломают компиляцию, и
  ; установщик не создаётся вовсе (в release остаётся только win-unpacked).
  ; Поэтому используется LogicLib: ответ сохраняется в переменную, переходов нет.
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "Удалить настройки NEXUS, профили VPN и список сайтов?$\r$\n$\r$\nВыберите «Нет», если планируете установить программу заново." \
      /SD IDNO IDYES +2
    StrCpy $0 "keep"

    ${if} $0 != "keep"
      SetShellVarContext current
      RMDir /r "$APPDATA\nexus-network-tools"
      RMDir /r "$LOCALAPPDATA\nexus-network-tools-updater"
      DetailPrint "Пользовательские данные удалены."
    ${else}
      DetailPrint "Настройки сохранены для будущей установки."
    ${endIf}
  ${endIf}
!macroend
