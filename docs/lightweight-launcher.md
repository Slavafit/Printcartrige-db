# Lightweight Windows launcher experiment

Task 015 keeps the Electron package intact and adds an alternative folder distribution. A self-contained .NET 8 WinForms launcher starts the existing Node.js HTTP backend, opens the system browser, and owns the system-tray lifecycle. It does not embed Chromium, WebView2, or CEF.

## Build

Install a .NET 8 SDK locally when no system SDK is available:

```powershell
curl.exe -L https://dot.net/v1/dotnet-install.ps1 -o .dotnet-install.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.dotnet-install.ps1 -Channel 8.0 -Architecture x64 -InstallDir .\.dotnet-sdk -NoPath
pnpm.cmd lightweight:package
```

The result is `release-lightweight\PrinterDB\`. Copy the complete folder; `PrinterDB.exe` is not a standalone distribution by itself. The folder contains the self-contained .NET launcher, a Node 22 runtime, the bundled backend, the built web client, the native Node 22 `better-sqlite3` binary, and the seed database.

Double-click `PrinterDB.exe`. Closing the browser does not stop PrinterDB. The tray menu provides **Abrir catálogo** and **Salir**. A second launch reopens the existing address instead of starting another server. The database and backups use the same `%APPDATA%\PrinterDB` directory as the Electron build.

## Measured comparison

Measurements were made on the same Windows host on 2026-10-12. Startup is elapsed time from process creation until `/api/stats` responded. RAM is the combined working set of the launcher and owned server processes after a one-second settle; the external Chrome process is excluded. These are single observations, not benchmarks.

| Parameter | Electron | Lightweight launcher |
|---|---:|---:|
| Build size | 493.3 MiB portable EXE; 492.7 MiB unpacked | 242.5 MiB folder |
| Combined RAM | 290.9 MiB | 148.4 MiB |
| First startup | 1,827 ms | 1,964 ms |
| Lightweight restart | n/a | 1,705 ms |
| Installed Node.js required | No | No |
| Installed .NET required | No | No |
| Separate system browser | Yes | Yes |
| System tray | Yes | Yes |

The lightweight folder is 250.8 MiB (50.8%) smaller than the measured Electron portable EXE, and used 142.5 MiB (49.0%) less combined application RAM in this run. Startup was 137 ms slower on the first lightweight run; this difference is too small and too lightly sampled to claim a general performance result.

## Verification and limitations

Verified on the build host: seed database creation; search API; manual create and edit; persistence across restart; automatic browser launch; no console window; second-instance rejection; operation with global Node.js and `dotnet` excluded from `PATH`; and graceful launcher/server shutdown. The diagnostic `--shutdown` path signals the same `ExitAsync` handler used by the tray **Salir** command.

The package is unsigned and Windows can show a reputation warning. It is a folder distribution rather than one EXE. The tray uses the generic Windows application icon. Online collectors are not included as separately runnable scripts in the minimal folder; normal catalog search, editing, import/export, and backup are present. The Electron build remains the primary option until this experiment receives routine Windows 11 user testing.
