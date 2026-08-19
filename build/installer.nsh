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

; --- Выбор ярлыков -----------------------------------------------------------
; Установщик electron-builder создаёт ярлыки молча. Пользователи привыкли решать
; это сами, поэтому добавлена отдельная страница с двумя галочками. Обе
; отмечены заранее: это привычное поведение, а снять отметку легко.
;
; Ярлыки не «не создаются», а удаляются сразу после создания: порядок шагов в
; шаблоне зафиксирован, и вклиниться до него нельзя. Для пользователя разницы
; нет — в конце установки ярлык либо есть, либо его нет.
;
; Весь этот блок нужен только установщику. Файл подключается и при сборке
; деинсталлятора — там нет ни страниц, ни nsDialogs, и компилятор NSIS выдаёт
; предупреждение, которое electron-builder считает ошибкой (ключ -WX). Поэтому
; страница объявляется только когда собирается установщик.
!ifndef BUILD_UNINSTALLER
  Var NexusShortcutDialog
  Var NexusDesktopCheckbox
  Var NexusStartMenuCheckbox
  Var NexusWantDesktop
  Var NexusWantStartMenu
!endif

!macro customPageAfterChangeDir
  ; Страница объявляется только в установщике: при сборке деинсталлятора её
  ; функции не компилируются, и ссылка на них оборвалась бы.
  !ifndef BUILD_UNINSTALLER
    Page custom NexusShortcutPageShow NexusShortcutPageLeave
  !endif
!macroend

!macro customHeader
  !ifndef BUILD_UNINSTALLER
  Function NexusShortcutPageShow
    ; Значения по умолчанию задаются здесь: страница может открыться не с
    ; первого раза, если пользователь вернулся кнопкой «Назад».
    ${if} $NexusWantDesktop == ""
      StrCpy $NexusWantDesktop "1"
    ${endIf}
    ${if} $NexusWantStartMenu == ""
      StrCpy $NexusWantStartMenu "1"
    ${endIf}

    ; При обновлении вопрос не задаётся: выбор сделан при первой установке.
    ; Пропуск выполняется здесь, а не макросом skipPageIfUpdated: тот
    ; рассчитан на страницы MUI и с собственной страницей прервал бы саму
    ; установку.
    ${if} ${isUpdated}
      Abort
    ${endIf}

    nsDialogs::Create 1018
    Pop $NexusShortcutDialog
    ${if} $NexusShortcutDialog == error
      Abort
    ${endIf}

    !insertmacro MUI_HEADER_TEXT "Ярлыки NEXUS" "Выберите, где разместить значки для запуска программы."

    ${NSD_CreateCheckbox} 0 10u 100% 12u "Создать значок на рабочем столе"
    Pop $NexusDesktopCheckbox
    ${if} $NexusWantDesktop == "1"
      ${NSD_Check} $NexusDesktopCheckbox
    ${endIf}

    ${NSD_CreateCheckbox} 0 30u 100% 12u "Добавить NEXUS в меню «Пуск»"
    Pop $NexusStartMenuCheckbox
    ${if} $NexusWantStartMenu == "1"
      ${NSD_Check} $NexusStartMenuCheckbox
    ${endIf}

    ${NSD_CreateLabel} 0 58u 100% 24u "Значки можно создать или удалить позже вручную. Программа работает независимо от них."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function NexusShortcutPageLeave
    ${NSD_GetState} $NexusDesktopCheckbox $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $NexusWantDesktop "1"
    ${else}
      StrCpy $NexusWantDesktop "0"
    ${endIf}

    ${NSD_GetState} $NexusStartMenuCheckbox $0
    ${if} $0 == ${BST_CHECKED}
      StrCpy $NexusWantStartMenu "1"
    ${else}
      StrCpy $NexusWantStartMenu "0"
    ${endIf}
  FunctionEnd
  !endif
!macroend

; --- Последний шаг мастера ---------------------------------------------------
; Шаблон electron-builder всегда добавляет страницу «Готово» с галочкой
; «Запустить NEXUS». При первой установке это уместно, но при обновлении — нет:
; человек нажал «Перезапустить и установить» и ждёт, что дальше всё произойдёт
; само, а вместо этого упирался в кнопку «Готово».
;
; Почему одной правки в коде программы мало. Команду установки отдаёт та копия
; NEXUS, которая уже стоит на компьютере, — то есть старая версия со старым
; поведением. Сколько ни меняй вызов в новом коде, при обновлении со старой
; версии он не выполнится. Поэтому пропуск сделан здесь, в самом установщике:
; он попадает в новую сборку и работает независимо от того, какая версия его
; запустила.
;
; Макрос customFinishPage заменяет штатную страницу целиком. При обновлении
; (${isUpdated} — установщик получил ключ --updated) страница пропускается, а
; приложение запускается сразу. При первой установке всё как прежде: финальный
; шаг с галочкой запуска.
!macro customFinishPage
  !ifndef BUILD_UNINSTALLER
    Function NexusLaunchAfterInstall
      ; Запуск идёт от имени пользователя, а не установщика: NEXUS работает с
      ; правами администратора, и без этого окно открылось бы в чужом сеансе.
      ;
      ; Переменная $1 используется намеренно вместо макроса StartApp: тот
      ; объявляет Var /GLOBAL startAppArgs, а его уже объявляет installSection.
      ; Повторное объявление той же переменной обрывает сборку установщика.
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endIf}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    ; Страница пропускается только при обновлении. Приложение запускается прямо
    ; здесь: после Abort шаг завершается, и до кнопки «Готово» дело не доходит.
    Function NexusSkipFinishPage
      ${if} ${isUpdated}
        Call NexusLaunchAfterInstall
        Abort
      ${endIf}
    FunctionEnd

    !define MUI_PAGE_CUSTOMFUNCTION_PRE NexusSkipFinishPage
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "NexusLaunchAfterInstall"
    !insertmacro MUI_PAGE_FINISH
  !endif
!macroend

; --- Применение выбора -------------------------------------------------------
; Выполняется после создания ярлыков штатным шаблоном.
!macro customInstall
  !ifndef BUILD_UNINSTALLER
  ${if} $NexusWantDesktop == "0"
    Delete "$newDesktopLink"
    Delete "$oldDesktopLink"
  ${endIf}
  ${if} $NexusWantStartMenu == "0"
    Delete "$newStartMenuLink"
    Delete "$oldStartMenuLink"
    ; Каталог удаляется только если он опустел: чужие ярлыки трогать нельзя.
    !ifdef MENU_FILENAME
      RMDir "$SMPROGRAMS\${MENU_FILENAME}"
    !endif
    ; Кнопка «Запустить NEXUS» на последнем шаге открывает $launchLink, а тот
    ; указывает на ярлык меню «Пуск». Без переключения на сам файл программы
    ; запуск после установки завершился бы ошибкой «файл не найден».
    StrCpy $launchLink "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${endIf}
  !endif
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
