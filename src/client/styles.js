const CSS = String.raw`
.dsh-interpret-root {
  --di-fg: var(--dsh-text-primary, #1f2328);
  --di-muted: var(--dsh-text-secondary, #6b7280);
  --di-border: var(--dsh-border-default, rgba(127,127,127,.22));
  --di-surface: var(--dsh-surface-primary, transparent);
  --di-raised: var(--dsh-surface-raised, rgba(127,127,127,.06));
  --di-accent: var(--dsh-accent, #4f7cff);
  --di-danger: var(--dsh-danger, #d14343);
  --di-ok: var(--dsh-success, #2f9e63);
  color: var(--di-fg);
  background: var(--di-surface);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 14px;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  .dsh-interpret-root {
    --di-fg: var(--dsh-text-primary, #e6e8eb);
    --di-muted: var(--dsh-text-secondary, #9aa1ab);
    --di-border: var(--dsh-border-default, rgba(255,255,255,.16));
    --di-raised: var(--dsh-surface-raised, rgba(255,255,255,.06));
  }
}
.di-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--di-border);
  flex: none;
}
.di-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; }
.di-title svg { opacity: .85; }
.di-sub { color: var(--di-muted); font-size: 12px; }
.di-spacer { flex: 1; }
.di-chip {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--di-border);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  color: var(--di-muted);
  white-space: nowrap;
}
.di-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--di-muted); }
.di-dot.ok { background: var(--di-ok); }
.di-dot.warn { background: #d9a520; }
.di-dot.bad { background: var(--di-danger); }
.di-dot.live { background: var(--di-ok); box-shadow: 0 0 0 3px rgba(47,158,99,.18); }
.di-btn {
  appearance: none; border: 1px solid var(--di-border); background: var(--di-raised);
  color: var(--di-fg); border-radius: 8px; padding: 7px 14px; font-size: 13px;
  cursor: pointer; font-weight: 500;
}
.di-select { width: 100%; box-sizing: border-box; margin: 4px 0 6px; padding: 5px 7px; border: 1px solid var(--di-border); border-radius: 7px; background: var(--di-surface); color: var(--di-fg); font: inherit; font-size: 12px; }
.di-btn:hover:not(:disabled) { border-color: var(--di-accent); }
.di-btn:disabled { opacity: .5; cursor: not-allowed; }
.di-btn.primary { background: var(--di-accent); border-color: var(--di-accent); color: #fff; }
.di-btn.danger { background: var(--di-danger); border-color: var(--di-danger); color: #fff; }
.di-btn.ghost { background: transparent; }
.di-banner {
  margin: 10px 16px 0; padding: 9px 12px; border-radius: 8px; font-size: 12px;
  border: 1px solid rgba(209,67,67,.35); background: rgba(209,67,67,.08); color: var(--di-fg);
  display: flex; gap: 10px; align-items: flex-start;
}
.di-banner .di-spacer { flex: 1; }
.di-body { display: flex; min-height: 0; flex: 1; }
.di-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.di-list { flex: 1; overflow: auto; padding: 10px 16px 18px; scroll-behavior: smooth; }
.di-empty { padding: 36px 16px; color: var(--di-muted); font-size: 13px; text-align: center; }
.di-empty strong { color: var(--di-fg); display: block; margin-bottom: 6px; }
.di-row { padding: 9px 0 10px; border-bottom: 1px dashed var(--di-border); }
.di-row:last-child { border-bottom: none; }
.di-meta { display: flex; align-items: center; gap: 8px; color: var(--di-muted); font-size: 11px; margin-bottom: 3px; }
.di-time { font-variant-numeric: tabular-nums; }
.di-src { border: 1px solid var(--di-border); border-radius: 4px; padding: 0 5px; }
.di-en { color: var(--di-muted); font-size: 13px; word-break: break-word; }
.di-zh { color: var(--di-fg); font-size: 16px; line-height: 1.55; margin-top: 3px; word-break: break-word; }
.di-zh.pending { color: var(--di-muted); font-size: 14px; font-style: italic; }
.di-badge { margin-left: auto; }
.di-badge.error { color: var(--di-danger); }
.di-badge.dropped { color: var(--di-muted); }
.di-aside {
  flex: none; width: 300px; border-left: 1px solid var(--di-border);
  padding: 12px 14px 20px; overflow: auto; display: flex; flex-direction: column; gap: 14px;
}
.di-card { border: 1px solid var(--di-border); border-radius: 10px; padding: 10px 12px; background: var(--di-raised); }
.di-card h4 { margin: 0 0 8px; font-size: 12px; color: var(--di-muted); font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
.di-kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 2px 0; }
.di-kv span:first-child { color: var(--di-muted); }
.di-kv span:last-child { text-align: right; word-break: break-word; }
.di-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.di-note { color: var(--di-muted); font-size: 11px; margin-top: 6px; }
.di-progress { height: 4px; background: var(--di-border); border-radius: 999px; overflow: hidden; margin-top: 8px; }
.di-progress > div { height: 100%; background: var(--di-accent); transition: width .2s linear; }
.di-test { display: flex; flex-direction: column; gap: 6px; }
.di-test textarea {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px;
  border: 1px solid var(--di-border); border-radius: 8px; padding: 6px 8px;
  background: var(--di-surface); color: var(--di-fg); font: inherit; font-size: 12px;
}
.di-result { font-size: 12px; border-left: 2px solid var(--di-accent); padding-left: 8px; white-space: pre-wrap; }
.di-footer { flex: none; border-top: 1px solid var(--di-border); padding: 6px 16px; color: var(--di-muted); font-size: 11px; display: flex; gap: 14px; align-items: center; }
.di-footer .di-spacer { flex: 1; }
.di-draft { opacity: .66; border-bottom-style: dotted; }
.di-draft .di-meta { color: var(--di-accent); }
.di-draft-en { font-style: italic; }
.di-history-item { border-top: 1px dashed var(--di-border); padding: 7px 0 3px; margin-top: 6px; }
.di-history-title { font-size: 12px; font-weight: 600; word-break: break-word; }
.di-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 24px; }
.di-modal { width: min(860px, 92vw); height: min(680px, 86vh); background: var(--di-surface); color: var(--di-fg); border: 1px solid var(--di-border); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,.35); }
.di-modal-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--di-border); }
.di-modal-list { flex: 1; overflow: auto; padding: 8px 14px 16px; }
.di-dock { height: 100%; }
.di-dock-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--di-border); flex: none; }
.di-dock-list { padding: 6px 10px 12px; }
.di-dock .di-title { font-size: 13px; }
.di-dock .di-row { padding: 6px 0; }
.di-dock .di-zh { font-size: 14px; }
.di-dock .di-en { font-size: 12px; }
.di-dock .di-footer { padding: 4px 10px; }
@media (max-width: 900px) {
  .di-aside { width: 240px; }
}
@media (max-width: 720px) {
  .di-body { flex-direction: column; }
  .di-aside { width: auto; border-left: none; border-top: 1px solid var(--di-border); max-height: 45%; }
}
`

let installed = false

/** Inject the panel stylesheet once per document. */
export function ensureStyles() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const style = document.createElement('style')
  style.setAttribute('data-dsh-interpret', 'styles')
  style.textContent = CSS
  document.head.appendChild(style)
}
