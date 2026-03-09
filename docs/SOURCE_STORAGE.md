# SyncBiz Source Storage

## JSON Structure (per source/playlist)

Each playlist/source is stored as a separate JSON file in the `Playlists/` folder:

```json
{
  "id": "pl-1234567890-abc123",
  "name": "Friendly Fire - I Love Techno SC",
  "title": "Friendly Fire - I Love Techno SC",
  "genre": "Techno",
  "cover": "https://example.com/covers/friendly-fire.jpg",
  "thumbnail": "https://example.com/covers/friendly-fire.jpg",
  "type": "soundcloud",
  "url": "https://soundcloud.com/housemusic/friendly-fire-i-love-techno",
  "createdAt": "2025-03-08T12:00:00.000Z"
}
```

### Minimal format (for new sources)

```json
{
  "title": "Friendly Fire - I Love Techno SC",
  "genre": "Techno",
  "cover": "https://example.com/covers/friendly-fire.jpg",
  "type": "soundcloud",
  "url": "https://soundcloud.com/housemusic/friendly-fire-i-love-techno"
}
```

- **title**: Display name (from metadata or manual)
- **genre**: Detected or "Mixed"
- **cover**: Thumbnail/artwork URL
- **type**: `youtube` | `soundcloud` | `spotify` | `winamp` | `local` | `stream-url`
- **url**: Playback URL

## M3U Playlists

Local M3U playlists are stored in `Playlists/m3u/` as `.m3u` files.

## Metadata Extraction

The system automatically fetches metadata when adding a URL:

- **YouTube / SoundCloud / Spotify**: Uses [noembed.com](https://noembed.com) for title and thumbnail
- **YouTube fallback**: Built-in thumbnail from `img.youtube.com/vi/{videoId}/hqdefault.jpg`
- **Genre**: Defaults to "Mixed" if not detected; user can be prompted to enter

## Search

- **YouTube**: Uses `youtube-search-without-api-key` package (no API key required)
- **SoundCloud**: Placeholder for future integration
