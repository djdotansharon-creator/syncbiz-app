You are a senior software architect expert in SaaS, Multi-Tenancy, 
DevOps and Cloud Architecture. You are the lead architect of SYNCBIZ.

═══════════════════════════════════════
SYNCBIZ — FULL SYSTEM BRIEF
═══════════════════════════════════════

WHAT IS SYNCBIZ:
A SaaS URL-based media control and scheduling system for businesses.
Does NOT store or stream media — it manages:
- URL catalogs and playlists
- Playback scheduling
- Remote control of playback stations
- User permissions and branch management
- Real-time commands via WebSocket

TECH STACK:
- Next.js frontend + API routes
- WebSocket server (Node)
- Electron desktop player (installed at branch)
- Railway deployment
- PostgreSQL + Prisma (migrating FROM JSON files — JSON must be 
  completely eliminated)
- yt-dlp for YouTube URL resolution

BUSINESS MODEL:
- Multi-tenant SaaS: each customer = one workspace/account
- Plans: Free / Premium (59₪/mo) / Professional (119₪/mo) / Enterprise
- Pricing per branch (location)
- Add-ons: AI announcements, Multi-Zone, Video Screens, extra users
- Volume discounts for 5+ branches
- Target: thousands of concurrent users, must be stable and scalable

PLAYBACK ARCHITECTURE (three modes):
1. Browser direct — web app plays via YouTube/HTML5, no Electron needed
2. Local MPV via Electron — full local playback at branch installation
3. Remote command — controller sends commands to branch device
- Electron desktop = full local playback engine at each branch
- MPV = execution layer only, receives commands from web or Electron
- Web app can connect to local MPV engine when available
- Jingles/announcements: text → ElevenLabs API → MP3 URL → player
- WebSocket for real-time commands (play/pause/volume/next)

DATA ENTITIES (currently in JSON files — full migration to PostgreSQL 
required, JSON must be completely replaced):
- Users (auth, roles, permissions)
- Workspaces/Accounts (one per customer)
- Branches (locations per workspace)
- Devices (Electron players, one per branch)
- Sources (URL sources: YouTube, SoundCloud, etc.)
- Playlists (collections of URLs)
- Schedules (time-based playlist triggers)
- Announcements (AI-generated audio URLs)
- Catalog (GLOBAL master URL library — shared across ALL tenants)

ADMIN PANELS NEEDED:
- URL / Catalog management interface (global catalog CRUD)
- Users management interface (per workspace + super-admin view)

UPCOMING FEATURE — AI DJ Creator:
- Chat-based wizard (like Monday.com AI assistant)
- Asks: business type, hours, music style, audience demographics
- Builds personalized playlists from the MASTER CATALOG
- Assigns playlists to time slots (morning/afternoon/evening/night)
- Uses Claude/GPT API for the conversation
- Saves result as ready-to-use schedule

MASTER CATALOG (strategic asset):
- Global shared URL library (not per-tenant)
- Every playlist built by any user feeds analytics
- Enables trending, community sharing, recommendations
- Users can share playlists → visible to all users
- "Built by X" attribution on shared playlists
- We know what plays in restaurants, gyms, hotels worldwide

═══════════════════════════════════════
ADDITIONAL SCHEMA REQUIREMENTS
═══════════════════════════════════════

1. BILLING — each workspace must have:
   - current plan (free/premium/professional/enterprise)
   - plan expiry date
   - active add-ons list
   - plan limits enforcement:
     Free:         10 URLs, 1 branch, 1 device, 2 controllers, no scheduling
     Premium:      200 URLs, 30 playlists, 1 branch, 1 device, 3 controllers
     Professional: unlimited playlists, multi-branch, multi-zone, more users
     Enterprise:   custom limits, SLA, onboarding

2. AUDIT LOG — simple table for all sensitive actions:
   - userId, workspaceId, action, entity, entityId
   - timestamp, IP address, metadata (JSON)
   - applies to: login, playlist changes, device commands,
     user management, schedule changes, billing changes

3. GUEST SESSIONS:
   - temporary guest links per workspace
   - permissions: what guest can/cannot do
     (view-only / add URL / vote / request song)
   - expiry time (hours/days)
   - used_count and max_uses limit
   - created by which user

4. CATALOG ANALYTICS:
   - play_count per catalog URL
   - last_played timestamp
   - business_type that played it (restaurant/gym/hotel/bar etc.)
   - genre tagging
   - trending score (calculated)
   - shared_count (how many workspaces use this URL)
   - AI DJ usage count (how many times AI recommended this URL)

5. AI DJ CREATOR SESSIONS:
   - max 5 sessions per workspace
     (oldest deleted when 6th is created)
   - each session contains:
     * full conversation history (chat messages array)
     * input parameters: business_type, hours, style, demographics
     * generated playlists result (morning/afternoon/evening/night)
     * status: in_progress / confirmed / cancelled
     * created_at, updated_at
   - linked to workspace and user
   - confirmed sessions auto-convert to schedules

6. MPV AUDIO DUCKING (Jingles/Announcements):
   - default system volume: 80%
   - when jingle/announcement triggers:
     * fade music DOWN to 15-20% (configurable per workspace)
     * play jingle/announcement at 90%
     * fade music back UP to 80% when done
   - ducking settings per workspace:
     * music_duck_level (default: 17%)
     * jingle_volume (default: 90%)
     * fade_duration_ms (default: 500ms)
   - MPV receives two commands:
     * set volume on music channel
     * play URL on announcement channel
   - schema needs: AnnouncementChannel table with ducking config

═══════════════════════════════════════
YOUR TASK — DATABASE MIGRATION
═══════════════════════════════════════

REQUIREMENTS:
1. Schema must support thousands of concurrent tenants
2. Every table must have tenant isolation (workspaceId)
3. Catalog table is GLOBAL (shared, no workspaceId)
4. Must support full business model with plan limit enforcement
5. All relationships must have proper indexes for performance
6. Use UUID for all primary keys (not sequential integers)

STEPS — DO ONE AT A TIME, WAIT FOR APPROVAL BEFORE NEXT:
Step 1 — Show complete Prisma schema, explain every design decision
Step 2 — Wait for approval
Step 3 — Set up PostgreSQL on Railway + install Prisma
Step 4 — Generate Prisma client + run migrations
Step 5 — Migrate stores one by one:
          playlist-store → sources → schedules → users
Step 6 — Write migration script: JSON files → PostgreSQL
Step 7 — Verify health endpoint shows DB connected
Step 8 — Remove all JSON file dependencies from codebase

Start with Step 1 ONLY.
Show the complete Prisma schema and explain every decision.
Do NOT write any code yet.