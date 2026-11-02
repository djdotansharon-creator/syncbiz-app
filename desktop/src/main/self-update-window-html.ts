/** The self-update window's page (pure string — testable without Electron). */

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** The window's page: white rounded card, "VONO" + the version, one black bar that keeps moving. No frame, no percentage. */
export function updateWindowHtml(version: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;-webkit-user-select:none;user-select:none}
.card{box-sizing:border-box;width:100%;height:100%;background:#fff;border-radius:18px;padding:22px 26px;display:flex;flex-direction:column;justify-content:center;gap:16px;animation:pop .32s cubic-bezier(.2,.9,.3,1.2) both}
.t{display:flex;align-items:baseline;gap:10px;color:#111}
.t b{font-size:22px;font-weight:800;letter-spacing:.06em}
.t span{font-size:14px;font-weight:600;color:rgba(17,17,17,.5)}
.bar{position:relative;height:4px;border-radius:4px;background:rgba(0,0,0,.08);overflow:hidden}
.bar i{position:absolute;top:0;bottom:0;width:38%;border-radius:4px;background:#111;animation:run 1.15s cubic-bezier(.45,0,.2,1) infinite}
@keyframes run{0%{left:-40%}100%{left:102%}}
@keyframes pop{0%{opacity:0;transform:scale(.9)}100%{opacity:1;transform:scale(1)}}
</style></head><body><div class="card"><div class="t"><b>VONO</b><span>${esc(version)}</span></div><div class="bar"><i></i></div></div></body></html>`;
}
