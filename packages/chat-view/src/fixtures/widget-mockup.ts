/**
 * A desktop settings-page mockup with a fixed-width sidebar — the shape that reflows
 * into a tall, cramped column on a phone unless it renders with `layout: 'fixed'`.
 */
export const SETTINGS_MOCKUP_WIDGET = `<style>
.mk{display:grid;grid-template-columns:176px minmax(0,1fr);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);overflow:hidden;font-size:13px;color:var(--color-text-primary)}
.sb{padding:10px 6px;border-right:0.5px solid var(--color-border-tertiary)}
.nv{padding:4px 8px;border-radius:6px;color:var(--color-text-secondary)}
.nv.on{background:var(--color-background-secondary);color:var(--color-text-primary);font-weight:500}
.ct{padding:20px 28px 28px;min-width:0}
.grp{background:var(--color-background-secondary);border-radius:10px;margin-top:12px}
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px}
.row+.row{border-top:0.5px solid var(--color-border-tertiary)}
.rd{font-size:12px;color:var(--color-text-secondary);margin-top:2px}
.sw{width:30px;height:18px;border-radius:9px;background:#378ADD;flex-shrink:0}
</style>
<div class="mk">
<div class="sb"><div class="nv on">General</div><div class="nv">Appearance</div><div class="nv">Usage</div><div class="nv">Providers</div><div class="nv">Browser</div><div class="nv">Terminal</div></div>
<div class="ct">
<div style="font-size:20px">General</div>
<div class="grp">
<div class="row"><div><div>Language</div><div class="rd">Applies immediately</div></div><button>English</button></div>
<div class="row"><div><div>Session notifications</div><div class="rd">When an agent finishes or needs approval</div></div><span class="sw"></span></div>
<div class="row"><div><div>Anonymous usage stats</div><div class="rd">Helps improve SuperOne, never includes chats</div></div><span class="sw"></span></div>
</div>
</div>
</div>
<div style="display:flex;justify-content:flex-end;margin-top:12px"><button>Ship this layout ↗</button></div>`
