# TaskSphere Desktop (Windows + macOS)

An Electron app that opens the live TaskSphere site (`https://pm.virtualspheretechnologies.in`)
in a native window. The website, the desktop app and the server share the same code and data,
so a frontend deploy updates desktop users too. You don't rebuild the app for website changes.

What the desktop app adds on top of the site:
- Its own installer, Start Menu / Dock icon, and a single window (opening it again focuses it)
- Windows / macOS notifications (the site's existing notifications)
- Screen-share picker for huddles; camera and microphone permissions
- Google sign-in in a popup window; other external links (Meet, Docs…) open in the browser
- "Can't reach TaskSphere" page with automatic retry when offline
- Remembers window size and position

## Run it locally
```bash
cd desktop
npm install
npm start
```
To test against a local server instead: `TASKSPHERE_URL=http://localhost:5000 npm start`
(in PowerShell: `$env:TASKSPHERE_URL="http://localhost:5000"; npm start`).

## Build installers
| Platform | Command | Output | Must build on |
|---|---|---|---|
| Windows | `npm run dist:win` | `dist/TaskSphere-Setup-1.0.0.exe` | Windows (or CI) |
| macOS | `npm run dist:mac` | `dist/TaskSphere-1.0.0.dmg` (Intel + Apple Silicon) | a Mac (or CI) |

**Without a Mac:** on GitHub open Actions → "Desktop app" → Run workflow (or push a tag like
`desktop-v1.0.0`). Both installers appear under the run's Artifacts.

Bump `version` in `package.json` before each release.

## Code signing (before giving it to many people)
Unsigned builds work, but:
- **Windows** shows a SmartScreen "Unknown publisher" warning (More info → Run anyway).
  Fix: an OV/EV code-signing certificate, set as `CSC_LINK` / `CSC_KEY_PASSWORD`.
- **macOS** blocks unsigned apps ("damaged" / "can't be opened"). For testing: right-click the app → Open,
  or run `xattr -cr /Applications/TaskSphere.app`.
  Fix: Apple Developer account ($99/yr), a "Developer ID Application" certificate, and notarization
  (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). electron-builder signs and notarizes
  automatically once these are set.

## Files
- `main.js`: window, link rules, permissions, screen-share handler, menu
- `picker.html` + `picker-preload.js`: the "Choose what to share" window
- `offline.html`: shown when the server can't be reached
- `build/icon.png`: app icon (1024×1024; converted to .ico/.icns at build time)
- `build/entitlements.mac.plist`: macOS camera / mic / network permissions
