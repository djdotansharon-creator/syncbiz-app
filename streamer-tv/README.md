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
- Auto-start on boot is **intentionally NOT implemented** (audited; add later only after on-device testing).

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
