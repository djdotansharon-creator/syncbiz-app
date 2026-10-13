/**
 * Jingles Stage 1 UI (owner 2026-10-12) — static guarantees. Run: npx tsx scripts/verify-jingles-ui.ts
 * (the rules themselves are tested in verify-jingles-audience.ts; this checks the UI wires them and nothing else)
 */
import { readFileSync } from "fs";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const bc = readFileSync("components/control-room/broadcast-panel.tsx", "utf8");
const panels = readFileSync("components/control-room/jingles-panels.tsx", "utf8");
const aud = readFileSync("components/control-room/jingle-audience.tsx", "utf8");
const studio = readFileSync("components/jingles-control/JinglesShell.tsx", "utf8");
const view = readFileSync("components/control-room/all-branches-view.tsx", "utf8");

assert("U1 BROADCAST SAFETY: only playable jingles every recipient is eligible for (UNASSIGNED never; brand-safe via the server rules)",
  bc.includes('import { isEligibleForBranch, isPlayable, rowAudience } from "@/lib/jingles/audience";') &&
  /isPlayable\(rowAudience\(j\)\) && recipients\.length > 0 && recipients\.every\(\(t\) => eligibleFor\(j, t\)\)/.test(bc) &&
  /offered\.map\(\(j\) =>/.test(bc) && !/\{jingles\.map\(\(j\) =>/.test(bc));
assert("U2 BROADCAST SAFETY at send: an ineligible branch gets NO command (reported 'not eligible')",
  /!eligibleFor\(jingle, t\)\s*\? \{ delivered: false, reason: "not_eligible" \}/.test(bc));
assert("U3 Broadcast targets carry the map region (eligibility input)", /regionId: r\.regionId \};/.test(view) && /regionId: RegionId \| null;/.test(bc));
assert("U4 PREVIEW is local only: the panels never send a command for a preview (useAudioPreview) — the only command is Play now",
  panels.includes('import { useAudioPreview } from "@/components/jingles-control/use-audio-preview";') &&
  (panels.match(/sendCommandWithAck\(/g) ?? []).length === 1 && /onClick=\{\(\) => preview\.toggle\(j\.url\)\}/.test(panels) && !/sendCommandTo\(/.test(panels));
assert("U5 PLAY NOW: explicit target = this branch, confirmed first ('Play in …?'), only when playable + online",
  /setArming\(j\.id\)/.test(panels) && /jg\.playConfirm/.test(panels) && /disabled=\{!j\.playable \|\| !j\.url \|\| !branch\.liveBranchId\}/.test(panels) &&
  /sendCommandWithAck\(branch\.liveBranchId, "PLAY_INTERRUPT", \{ url: j\.url \}\)/.test(panels));
assert("U6 branch panel: TWO groups only — 'Branch jingles' (LOCAL of this branch) + 'Available to this branch'; list from GET ?branchId=",
  /useJingles\(`\/api\/jingles\/library\?branchId=\$\{encodeURIComponent\(branch\.id\)\}`\)/.test(panels) &&
  /jg\.ofBranch/.test(panels) && /jg\.available/.test(panels) && !/jg\.network"\)\}<\/p>/.test(panels));
assert("U7 HQ-only: Jingles entry, Share / Assign; Pending assignment (UNASSIGNED) only in the HQ panel",
  /\{isHQ \? \(\s*<button/.test(view) && /isHQ && j\.audience === "LOCAL"/.test(panels) && /jinglesOpen && isHQ/.test(view) &&
  /j\.audience === "UNASSIGNED"\)/.test(panels));
assert("U8 SAME Studio (A'): the Control Room renders JinglesWorkspacePanel with the controlRoom surface — no copy",
  panels.includes('import { JinglesWorkspacePanel } from "@/components/jingles-control/JinglesShell";') && /<JinglesWorkspacePanel[\s\S]{0,80}controlRoom=\{\{/.test(panels));
assert("U9 Control Room surface hides local On-Air, Pads, local Schedule / Add to Pad; tabs too; Save blocked without an audience",
  /\{!isCR \? \(\s*<nav className="jc-ws-tabs"/.test(studio) && /\{!isCR \? \(\s*<div className="jcx-quickpads">/.test(studio) &&
  /\{isDesktop && !isCR \? \(/.test(studio) && studio.includes("{!isCR ? <button type=\"button\" className=\"jc-btn jc-btn--ghost\" onClick={() => setAssignForAsset(resultCard)}>") &&
  studio.includes("{!isCR ? <button type=\"button\" className=\"jc-btn jc-btn--ghost\" onClick={() => setScheduleForAsset(resultCard)}>") &&
  /if \(controlRoom && !controlRoom\.audience\) \{ setGenerateError\(controlRoom\.saveBlockedText\); return; \}/.test(studio));
assert("U10 player surface unchanged: without controlRoom the save request is exactly the old body",
  /body: JSON\.stringify\(\{ title: a\.title, url: a\.url, voiceId: a\.voiceId, script: a\.script, durationSec: durationLabelToSec\(a\.durationLabel\), \.\.\.\(audience \?\? \{\}\) \}\)/.test(studio) &&
  /saveJingleToCloud\(resultCard, controlRoom \? controlRoom\.audience : undefined\)/.test(studio));
assert("U11 CREATE context: brand + region → BRAND_REGION, open branch → LOCAL, nothing → must choose (no silent default)",
  /if \(ctx\.branchId\) return \{ \.\.\.EMPTY_DRAFT, audience: "LOCAL"/.test(aud) && /audience: "BRAND_REGION", audienceBrandId: ctx\.brandId, audienceRegion: ctx\.region/.test(aud) &&
  /return EMPTY_DRAFT;\n\}/.test(aud) && /branchId: openId \}\)/.test(view));
assert("U12 users never see technical names: badges = NETWORK / brand / region / brand · region / LOCAL · branch",
  /case "BRAND_REGION":\s*return `\$\{brand\(a\.audienceBrandId\)\} · \$\{region\(a\.audienceRegion\)\}`/.test(aud) && !/>BRAND_REGION</.test(aud + panels));
assert("U13 promote / assign = PATCH the SAME row (no copy)", /fetch\(`\/api\/jingles\/library\/\$\{encodeURIComponent\(id\)\}`, \{ method: "PATCH"/.test(aud) && !/method: "POST"/.test(aud + panels));
const vx = readFileSync("components/management/vx-select.tsx", "utf8");
const settings = studio.slice(studio.indexOf('<div className="jcx-settings-bar">'), studio.indexOf('<div className="jcx-create-main">'));
assert("U14 STEP 1 VxSelect: no native <select> in the Studio settings row (Type / Language / Voice / Speed / Bell) or the audience editor (Brand / Region / Branch)",
  settings.length > 0 && !/<select/.test(settings) && (settings.match(/<VxSelect/g) ?? []).length === 5 && !/<select/.test(aud) && (aud.match(/<VxSelect/g) ?? []).length === 3);
assert("U15 same logic: Language still resets the voice; Bell still maps off → preRoll false; audience fields still null when empty",
  /voice: VOICE_PRESETS_BY_LANG\[v as JingleLanguage\]\[0\]\.voiceId/.test(settings) && /preRoll: v !== "off"/.test(settings) &&
  /audienceBrandId: v \|\| null/.test(aud) && /audienceRegion: \(v \|\| null\) as RegionId \| null/.test(aud) && /audienceBranchId: v \|\| null/.test(aud));
assert("U16 VxSelect is accessible: combobox + listbox + option, aria-expanded / activedescendant / selected; Escape / Home / End / type-ahead",
  /role="combobox"/.test(vx) && /role="listbox"/.test(vx) && /role="option"/.test(vx) && /aria-activedescendant=/.test(vx) && /aria-selected=/.test(vx) &&
  /case "Escape"/.test(vx) && /case "Home"/.test(vx) && /case "End"/.test(vx) && /typeahead\(/.test(vx));
console.log(`\n${pass} passed, ${fail} failed`);
