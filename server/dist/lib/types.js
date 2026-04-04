"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVICE_COMMANDS = exports.SOURCE_TYPE_LABELS = void 0;
/** Display labels for source types (e.g. in UI). */
exports.SOURCE_TYPE_LABELS = {
    web_url: "Web URL",
    stream_url: "Stream URL",
    playlist_url: "Playlist URL",
    local_playlist: "Local Playlist",
    browser_target: "Browser target",
    app_target: "App target",
    tts: "TTS",
};
/** Commands sent to the local endpoint agent. Device executes playback. */
exports.DEVICE_COMMANDS = [
    "OPEN_URL",
    "STOP_CURRENT",
    "PLAY_TARGET",
    "PLAY_TTS",
    "SET_VOLUME",
    "RESUME_PREVIOUS",
];
