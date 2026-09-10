; Updates reuse the existing WebView2 profile. A real uninstall clears the shared
; installed/portable profile, including Sign-in, local settings and desktop logs.
!macro NSIS_HOOK_POSTUNINSTALL
  StrCmp $UpdateMode 1 voice_chat_cleanup_done
  SetShellVarContext current
  RMDir /r "$APPDATA\${BUNDLEID}"
  RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  voice_chat_cleanup_done:
!macroend
