# Chrome browser

SuperOne's `browser_*` tools can drive the user's Chrome, in addition to the
browser embedded in the desktop window.

The desktop listens on a unix socket in the variant's SuperOne home
(`chrome-bridge.sock`). Each browser that loads the extension starts its own
native messaging host, which bridges that browser's stdio to the socket and
names itself (Chrome, Edge, Brave, Arc, Chromium, and the Chrome channels that
have a host). The host proves it read `chrome-bridge.token` before any command
is accepted. The extension id is pinned in the host manifest, so another
extension cannot connect. Two browsers stay connected at once; a later browser
does not replace an earlier one.

A tab is addressable only when the user shares it from the extension popup, or
when an agent opens it with `browser_tabs` `host:"chrome"`. Agent-opened tabs
go into a Chrome tab group named SuperOne and stay with the session that opened
them. Shared tabs are available to every session on that computer. Agents pass
`tab: "chrome:<browser>:<id>"` (for example `chrome:edge:4`) to the existing
browser tools. `chrome:<id>` still addresses a tab when only one browser is
connected, or when that tab id is unique among the connected browsers. When
more than one browser is connected, `browser_tabs` `action=open` takes
`browser` (`chrome`, `edge`, `brave`, `arc`, `chromium`, `chrome-beta`, or
`chrome-canary`). There is no separate `chrome_*` tool.

Page actions run the same scripts as the embedded browser, through
`Runtime.evaluate`. CDP actions (network, performance, emulation, cookies, file
inputs) use `chrome.debugger` on that tab. Screenshots use
`Page.captureScreenshot`. Recordings use `Page.startScreencast` and are encoded
to WebM in an extension offscreen document. Downloads the page starts are
reported through `Page.downloadWillBegin` and `chrome.downloads`, then listed
with the session's other captures.

Chrome shows a debugging banner while a tab is attached. DevTools cannot be
attached to that tab at the same time. `browser_download` uses Chrome's cookie
jar when Chrome is the only browser that session is driving, and saves a copy
where SuperOne can read it. A download the page itself starts is granted for
reading when it finishes. For a session on a remote node, that file is also
sealed into the session directory.

`browser_tools_list` and `browser_tools_call` read WebMCP tools on a Chrome tab
through the debugger's WebMCP domain. When that domain is missing, they fall
back to `document.modelContext` in the top document. Chrome exposes that API
only with `chrome://flags/#enable-webmcp-testing` (relaunch after changing it)
or on a site in the WebMCP origin trial. A Chrome that does not expose WebMCP
is reported as unavailable, separately from a page that registered nothing.
Tools the debugger can see in a cross-origin frame are listed only when the
top document is itself allowed to see them.

Settings → Browser explains this and shows whether any extension is connected.
The steps are: pick a browser, open its extensions page (or copy the address), turn on Developer mode, and drag the folder onto that page.
The same folder can be loaded in more than one browser. Mentioning a browser
whose extension is connected tells the agent to use `browser_*` tools with
`host: "chrome"` and that browser's id. That stays true when Computer Use is
also on. A Chromium browser that has not connected — including channels with
no native host, such as Edge Beta — stays on Computer Use when that is on.
With Computer Use off, only the connected browsers appear in `@`.

Each SuperOne variant has its own unpacked extension. Load
`~/.superone/dev/chrome-extension` or `~/.superone/alpha/chrome-extension`
once. The path is that variant's own home and does not follow an inherited
`SUPERONE_HOME`. Dev and alpha link their files to the source tree and link
the icon to that variant's app icon, so later source edits stay on the same
loaded directory. `bun run dev` retargets the Dev links at the checkout
that just started, including a git worktree, before Electron starts. Stable copies its files into `~/.superone/chrome-extension`
because a packaged app has no live checkout. The directory itself is real.
The manifest name is the product name plus the app version, which is the text
Chrome shows on the debugger banner. Reload the extension after an app update
so Chrome picks up a new name.
