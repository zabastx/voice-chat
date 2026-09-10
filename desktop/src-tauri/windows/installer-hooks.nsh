; Updates reuse the existing WebView2 profile. A real uninstall clears the shared
; installed/portable profile, including Sign-in, local settings and desktop logs.
!macro NSIS_HOOK_PREUNINSTALL
  StrCmp $UpdateMode 1 voice_chat_stop_done
  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 voice_chat_stop_done
  ; The installed binary joins the shared single-instance identity, so --exit also
  ; stops a running Portable copy even when its executable was renamed or moved.
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --exit' $0
  Sleep 1000
  voice_chat_stop_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  StrCmp $UpdateMode 1 voice_chat_cleanup_done
  SetShellVarContext current
  RMDir /r "$APPDATA\${BUNDLEID}"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  voice_chat_cleanup_done:
!macroend
