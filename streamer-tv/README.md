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

## Building — CI does it, no local Android tooling needed

You do **not** install Android Studio, Gradle, the SDK, or ADB. The APK is built
by GitHub Actions: [`.github/workflows/streamer-tv.yml`](../.github/workflows/streamer-tv.yml).

- **Test build (debug APK):** Actions → *VONO Streamer (Android TV)* → **Run workflow**.
  Produces `VONO-Streamer-debug.apk` as a downloadable build artifact. Debug APKs are
  self-signed and installable immediately for testing.
- **Customer build (signed release APK):** push a tag `streamer-v<version>`
  (e.g. `streamer-v1.0.0`). CI builds the **signed** `VONO-Streamer-release.apk`
  and attaches it to a GitHub Release. The in-app Downloads page serves that asset
  automatically (see "Delivery" below). A manual run also builds the signed release
  APK when the signing secrets are configured.

### Signing material required (one-time, provided by the account owner)

Nothing secret is committed. To produce signed customer releases, add these as
**GitHub repository secrets** (Settings → Secrets and variables → Actions):

| Secret | What it is |
|---|---|
| `VONO_KEYSTORE_BASE64` | base64 of the release keystore (`.jks`) |
| `VONO_KEYSTORE_PASSWORD` | keystore password |
| `VONO_KEY_ALIAS` | key alias |
| `VONO_KEY_PASSWORD` | key password |

Create the keystore once (on any machine with a JDK, or ask Claude to generate the
exact `keytool` command), then base64-encode the `.jks` for the secret. Keep the
`.jks` and passwords in a password manager — losing them means future updates can't
be signed with the same identity. `signingConfigs.release` in `app/build.gradle`
reads these from the environment; with no secrets the release APK is built unsigned
and the debug APK still works.

### Advanced / optional: build locally

Only if you *want* to: with **JDK 17** + **Android SDK** (or Android Studio),
`cd streamer-tv && gradle wrapper --gradle-version 8.9 && ./gradlew assembleDebug`.
The Gradle wrapper jar is not committed (binary); `gradle wrapper` regenerates it.

## Delivery — how the APK reaches a customer

The signed release APK attached to a `streamer-v*` GitHub Release is served through
our own site, so the customer never touches GitHub, ADB, or a terminal:

- **Web:** the in-app **Downloads & Apps** page (`/downloads`, linked from Settings)
  → **Download VONO Streamer**. That button hits `/api/streamer/apk/download`
  (same-origin), which 302-redirects to the current signed APK.
- **Resolution order** (`lib/streamer-apk-resolve.ts`): `STREAMER_APK_URL` env
  override (a public https URL — Railway/R2/CDN) → latest `streamer-v*` GitHub
  Release `.apk` → honest "release build in progress" state.

## Customer install flow (non-technical, no ADB)
1. On the TV device, open the browser, go to VONO → **Downloads** → **Download VONO Streamer**.
2. If the TV asks to **allow installing apps from this source**, choose **Allow**
   (a one-time system prompt), then open the downloaded file to install.
3. Open **VONO Streamer** from the TV home screen, **sign in once**. It stays
   signed in, opens full-screen, and registers as the branch MASTER — exactly like
   the web streamer.

### Removing the "allow from this source" step — Google Play (later)
Sideloading shows that one-time "unknown source" prompt. Publishing to the **Google
Play Store** (Android TV section) removes it: the customer just installs from Play.
To publish later you need a **Google Play Developer account** (one-time US$25), a
signed **App Bundle** (`.aab` — add an `assembleRelease`/`bundleRelease` variant),
a privacy policy URL, store listing assets (icon, TV banner, screenshots), and to
pass Android TV quality/content review. Play App Signing then manages the signing
key. This module is Play-ready in structure; publishing is an account/approval step,
not a code change.

## Caveats / needs on-device verification
- **Target must actually be Android TV / Google TV.** Plain non-Android DVB boxes cannot run this APK.
- **System WebView version** on older TV boxes may lag; verify the streamer loads and stays connected.
- The APK is **built and signed in CI**; first-run behavior is verified on a real device (see below).

---

## Appliance behavior (v0.2)

- **Settings screen** (open from the player with the **MENU** button or a **long-press BACK**): Start-on-boot, Auto-resume, Audio output, Connection status, App version.
- **Start on boot** (optional, default OFF): `BootReceiver` launches the player on `BOOT_COMPLETED`. **Best-effort only** — see limitations below.
- **Auto-resume** (default ON): **owned entirely by the web engine.** On load the player restores its last queue/track/position/volume from its own `localStorage` recovery (`syncbiz-playback-recovery-v2`, 24h TTL) and **auto-plays if it was playing within the last ~30 min** (`RECOVERY_AUTOPLAY_WINDOW_MS`). The shell adds no playback logic and **never clears recovery state.** It signals intent with a URL flag the engine honors: `autoresume=1` (ON) or `autoresume=0` (OFF). With **Auto-resume OFF** the engine still restores the full session (playlist, queue, current track, position) — it simply does **not** auto-start; the user presses play, and all remote CONTROL commands work normally. See `restoreAutoplaySuppressed()` in `lib/playback-provider.tsx`.
- **Audio output**: the Settings screen **lists available outputs** (HDMI / Bluetooth / analog / speaker / USB) via `AudioManager.GET_DEVICES_OUTPUTS` and opens the OS **Sound**/**Bluetooth** settings. It does **not** force a route — on Android TV the OS owns route selection; the shell never fakes it.

### Start on boot — limitations
On **Android 14** and depending on the TV OEM, launching an Activity from `BOOT_COMPLETED` is subject to background-activity-launch limits and may be **blocked or delayed**. This shell does **not** use device-owner / kiosk / lock-task, so start-on-boot is a convenience, not a guarantee. If it does not launch on your device, open VONO Streamer manually (a device-owner/kiosk provisioning path can be added later if the pilot requires guaranteed boot-launch).

## First validation on GOtv Y (Android TV 14) — from a CI build

No local build machine. Get the APK from CI, then install once for validation:
1. Run the **VONO Streamer (Android TV)** workflow (or push a `streamer-v*` tag),
   then download the `vono-streamer-apk` artifact / Release asset.
2. Fastest customer-style install on the box: open the browser on the GOtv Y →
   the VONO **Downloads** page → **Download VONO Streamer** → allow the one-time
   "unknown source" prompt → open the file to install. (A technician may instead
   sideload with ADB, but customers never need to.)
3. Launch **VONO Streamer** → **log in once** → it registers as MASTER exactly like
   the web streamer. Open **Settings** (MENU / long-press BACK) to enable
   Start-on-boot and confirm Auto-resume.

## On-device verification (after install)
- App launches fullscreen into the streamer; logs in once; session persists across relaunch.
- Registers as MASTER; remote Play/Pause/Next/Volume from mobile CONTROL works (unchanged from web).
- Screen stays awake during playback.
- **Auto-resume ON:** play, reboot within ~30 min → playback resumes automatically. (On, but > 30 min since last play → restores paused by design.)
- **Auto-resume OFF:** play, reboot → the session (playlist/queue/track/position) is still restored, but playback does NOT start until you press play; recovery state is never cleared.
- **Start on boot:** enable, reboot → app launches (verify on this OEM; may be blocked per limitations).
- **Audio output:** Settings lists the real outputs; Sound/Bluetooth buttons open OS settings.
