@echo off
setlocal

rem openssl req -newkey rsa:2048 -new -nodes -keyout key.pem -out csr.pem && openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out server.crt
rem http-server -S -K key.pem -C server.crt

::: Kill existing processes (token 3 if specific, token 10 if all)
set "FIELDS=handle^,name^,commandline"

rem taskkill /im "ngrok.exe" 2>nul
for /f "delims=, tokens=3" %%f in ('wmic path win32_process get %FIELDS% /format:csv ^| findstr /v findstr.exe ^| findstr ngrok.exe') do (
  if not "%%f"=="name" (
    echo PID/ngrok: %%f
	TASKKILL /PID %%f
  )
)

rem taskkill /im cmd.exe /fi "WINDOWTITLE eq http-server*"
for /f "delims=, tokens=3" %%f in ('wmic path win32_process get %FIELDS% /format:csv ^| findstr /v findstr.exe ^| findstr node.exe ^| findstr [lh][it][vt][ep]-server') do (
  if not "%%f"=="name" (
    echo PID/http-server: %%f
	TASKKILL /PID %%f /F
  )
)

taskkill /im WindowsTerminal.exe /fi "WINDOWTITLE eq http-server*" >nul

::: Live server on port 8080 (rather than parcel's dev mode on port 1234) as this WebSocket works through ngrok's https
rem start "http-server" cmd /c live-server --no-browser dist

::: Ngrok to make public
rem start "ngrok" ngrok http 8080

start "http-server-ngrok" wt new-tab --title "http-server-ngrok" -d . cmd /c "title http-server-ngrok && live-server --no-browser dist" ; split-pane --title "http-server-ngrok" ngrok http 8080

::: Wait for Ngrok to start
:wait_for_ngrok
echo.Waiting for ngrok...
choice /C 0 /D 0 /T 1 >nul

::: Display Ngrok current forwarding details
SET TUNNEL=
FOR /F "tokens=* USEBACKQ" %%F IN (`curl -s http://127.0.0.1:4040/api/tunnels ^| bash -c "grep -o 'https://............\.ngrok\.io'"`) DO (
  SET TUNNEL=%%F
)
IF "%TUNNEL%"=="" GOTO wait_for_ngrok
ECHO Now listening on: %TUNNEL%
SET QRCODE=
FOR %%X IN (qrcode.exe) do set QRCODE=%%~$PATH:X
IF DEFINED QRCODE "%QRCODE%" --invert --output:medium "%TUNNEL%"
ECHO.%TUNNEL%
rem adb shell am start -n com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity -d "%TUNNEL%" --activity-clear-task
rem (open local Chrome and use "Send to your devices" to open on phone).
IF NOT "%TUNNEL%"=="" start chrome.exe "%TUNNEL%#debug&nodetails&config=0"


::: Start parcel's watch mode
npm run dev
