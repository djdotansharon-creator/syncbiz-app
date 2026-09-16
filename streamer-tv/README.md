# VONO Streamer — Android TV / Google TV shell

A **generic, thin WebView shell** that wraps the existing hosted VONO web streamer.
There is **no** GOtv-specific code, no native playback engine, no WebSocket client,
and no MASTER/CONTROL logic in this module — the web page does all of that.

## Product architecture

**ONE streamer web engine + platform-specific thin shells.**

- The engine is the web route `/streamer?device=streamer&mode=player` (unchanged).
- This module is one thin Android shell that loads that URL fullscreen.

### Fallback matrix (which streamer each device uses)

| Device | Streamer used |
|---|---|
| Android TV / Google TV, Android TV boxes & sticks, Chromecast with Google TV, Xiaomi TV Box, Nvidia Shield, other certified Android TV | **VONO Streamer APK** (this module) |
| Any device with a capable modern browser (smart TVs with a good browser, a PC/mini-PC on the display, etc.) | **VONO Web Streamer** — open `/streamer?device=streamer&mode=player` directly |
| Unsupported / closed TV OS (non-Android DVB decoders, proprietary smart-TV OSes without a capable browser) | **Future dedicated wrapper only if required** — not built unless a specific box demands it |

The APK is a convenience wrapper (launcher icon, fullscreen, keep-awake, session,
auto-recovery). The web streamer remains the universal fallback and single source
of truth for behavior.

## What the shell does
- **Launcher entry** on the Android TV home row (`LEANBACK_LAUNCHER` + `android:banner`) and normal launchers (`LAUNCHER`).
- **VONO icon + TV banner** (generated from the VONO logo).
- **Fullscreen / immersive** (system bars hidden).
- **Keep screen awake** (`FLAG_KEEP_SCREEN_ON`).
- **Persistent login/session** (cookies + DOM storage kept across launches — log in once in the shell).
- **Always reopens into streamer mode** (`singleTask`, loads the streamer URL on start).
- **Resilient reload/recovery** — main-frame load errors trigger a bounded-backoff reload (2s → 30s).
- **Back button** does not walk history or drop to the launcher mid-session.

It does **not**: change the web streamer, touch the server, add a native player,
duplicate the WebSocket client, or change MASTER/CONTROL.

## Configuration
- Hosted URL is `MainActivity.STREAMER_URL`. Change it there if the hosted origin changes.
- `applicationId` / package: `com.vono.streamer`. `minSdk 21`, `targetSdk 34`.
- Start-on-boot is an **optional, best-effort** setting (default OFF) — see "Appliance behavior (v0.2)" and "Start on boot — limitations" below.

## Building (requires a machine with the Android toolchain)

> Not built here — the dev machine has no JDK / Android SDK / Gradle. Nothing in
> this module is compiled or verified yet.

Prerequisites: **JDK 17**, **Android SDK** (platform API 34 + build-tools) or
**Android Studio** (bundles everything). Then:

1. Open `streamer-tv/` in Android Studio (it will generate the Gradle wrapper jar
   and `local.properties` pointing at the SDK), **or** from a shell with the SDK:
   ```
   cd streamer-tv
   gradle wrapper           # one-time: generates gradle/wrapper/gradle-wrapper.jar
   ./gradlew assembleDebug  # → app/build/outputs/apk/debug/app-debug.apk
   ```
2. For a shippable build, configure signing and run `./gradlew assembleRelease`.

The Gradle **wrapper jar** is intentionally not committed (binary); Android Studio
or `gradle wrapper` regenerates it. Plugin/SDK versions in `build.gradle` are a
known-compatible set — adjust to the build machine if it flags a mismatch.

## Installing on the TV device
1. On the device: enable **Developer options** → network/USB debugging + "install unknown apps".
2. From the build machine on the same LAN: `adb connect <device-ip>:5555` then
   `adb install app/build/outputs/apk/debug/app-debug.apk` (or sideload the APK).
3. Launch **VONO Streamer** from the home row → it opens fullscreen → **log in once**
   (the `/streamer` route is auth-protected; the session then persists) → it registers
   as the branch MASTER exactly like the web streamer.

## Caveats / needs on-device verification
- **Target must actually be Android TV / Google TV.** Plain non-Android DVB boxes cannot run this APK.
- **System WebView version** on older TV boxes may lag; verify the streamer loads and stays connected.
- APK build + runtime are **unverified** until compiled on a real toolchain and run on a real device.

---

## Appliance behavior (v0.2)

- **Settings screen** (open from the player with the **MENU** button or a **long-press BACK**): Start-on-boot, Auto-resume, Audio output, Connection status, App version.
- **Start on boot** (optional, default OFF): `BootReceiver` launches the player on `BOOT_COMPLETED`. **Best-effort only** — see limitations below.
- **Auto-resume** (default ON): **owned entirely by the web engine.** On load the player restores its last queue/track/position from its own `localStorage` recovery (`syncbiz-playback-recovery-v2`, 24h TTL) and **auto-plays if it was playing within the last ~30 min** (`RECOVERY_AUTOPLAY_WINDOW_MS`). The shell adds no playback logic — it only keeps WebView storage across restarts and allows autoplay without a gesture. Turning Auto-resume OFF makes the shell clear those recovery keys on exit so the next launch starts fresh.
- **Audio output**: the Settings screen **lists available outputs** (HDMI / Bluetooth / analog / speaker / USB) via `AudioManager.GET_DEVICES_OUTPUTS` and opens the OS **Sound**/**Bluetooth** settings. It does **not** force a route — on Android TV the OS owns route selection; the shell never fakes it.

### Start on boot — limitations
On **Android 14** and depending on the TV OEM, launching an Activity from `BOOT_COMPLETED` is subject to background-activity-launch limits and may be **blocked or delayed**. This shell does **not** use device-owner / kiosk / lock-task, so start-on-boot is a convenience, not a guarantee. If it does not launch on your device, open VONO Streamer manually (a device-owner/kiosk provisioning path can be added later if the pilot requires guaranteed boot-launch).

## Build on Windows → install to GOtv Y (Android TV 14)

Prerequisites (none are currently installed on the dev machine):
1. **JDK 17** (Temurin/OpenJDK 17). Set `JAVA_HOME`.
2. **Android SDK** — easiest is **Android Studio** (bundles SDK, platform-tools/adb, and generates the Gradle wrapper). CLI alternative: Android command-line tools + `sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"` then `sdkmanager --licenses`.
3. If not using Android Studio: **Gradle 8.9** (to generate the wrapper once).

Build (from `streamer-tv/`):
```
gradle wrapper            # one-time (or open the folder in Android Studio, which does this)
.\gradlew.bat assembleDebug
# → app\build\outputs\apk\debug\app-debug.apk
```

Install to the connected GOtv Y:
1. On the box: Settings → About → click **Build** 7× to enable Developer options → enable **USB/Network debugging**. Note the box IP (Settings → Network).
2. From the build machine (same LAN): `adb connect <box-ip>:5555` then `adb install -r app\build\outputs\apk\debug\app-debug.apk`.
3. Launch **VONO Streamer** from the Android TV home row → **log in once** → it registers as MASTER exactly like the web streamer. Open **Settings** (MENU / long-press BACK) to enable Start-on-boot and confirm Auto-resume.

## On-device verification (after install)
- App launches fullscreen into the streamer; logs in once; session persists across relaunch.
- Registers as MASTER; remote Play/Pause/Next/Volume from mobile CONTROL works (unchanged from web).
- Screen stays awake during playback.
- **Auto-resume:** play, reboot within ~30 min → playback resumes automatically. (Off > 30 min restores paused by design.)
- **Start on boot:** enable, reboot → app launches (verify on this OEM; may be blocked per limitations).
- **Audio output:** Settings lists the real outputs; Sound/Bluetooth buttons open OS settings.
