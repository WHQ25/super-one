// @ts-expect-error — ?raw import returns string
import runtimeSrc from '@superone/shared/miniapp-api-runtime.js?raw'

const inlineSafeRuntimeSrc = (runtimeSrc as string).replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')

function generateTransportBlock(appId: string): string {
  return `${inlineSafeRuntimeSrc}

  var pending = new Map();
  var reqId = 0;
  var eventHandlers = new Map();

  var transport = {
    send: function(type, data) {
      parent.postMessage(Object.assign({ type: type, appId: '${appId}' }, data), '*');
    },
    request: function(reqType, resType, data, resultKey) {
      return new Promise(function(resolve, reject) {
        var id = ++reqId;
        pending.set(resType + ':' + id, { resolve: resolve, reject: reject, resultKey: resultKey });
        parent.postMessage(Object.assign({ type: reqType, id: id, appId: '${appId}' }, data), '*');
      });
    },
    on: function(type, handler) {
      eventHandlers.set(type, handler);
    }
  };

  window.addEventListener('message', function(e) {
    var data = e.data;
    if (!data || !data.type) return;

    if (data.id != null) {
      var key = data.type + ':' + data.id;
      var p = pending.get(key);
      if (p) {
        pending.delete(key);
        if (data.error) { p.reject(new Error(data.error)); }
        else { p.resolve(p.resultKey ? data[p.resultKey] : data.result); }
        return;
      }
    }

    var handler = eventHandlers.get(data.type);
    if (handler) handler(data);
  });`
}

function generateReadyBlock(): string {
  return `
  startSuperoneResize(transport);
  installSuperoneMediaProbe(transport);
  startSuperoneReady(window.superone);`
}

export function generatePopoverBridgeScript(appId: string, version: string, locale: string, initialData: unknown): string {
  const dataJson = JSON.stringify(initialData ?? null)
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)}, { initialLocale: ${JSON.stringify(locale)} });
  delete window.superone.ui.showPopover;

  var popoverMsgListeners = [];
  window.superone.popover = {
    data: ${dataJson},
    postMessage: function(data) { transport.send('miniapp-popover-msg', { data: data }); },
    onMessage: function(cb) { popoverMsgListeners.push(cb); },
    close: function() { transport.send('miniapp-popover-close', {}); },
  };
  transport.on('miniapp-popover-msg', function(d) {
    popoverMsgListeners.forEach(function(cb) { cb(d.data); });
  });
${generateReadyBlock()}
})();
</script>`
}

export function generateBridgeScript(appId: string, version: string, locale: string): string {
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)}, { initialLocale: ${JSON.stringify(locale)} });
${generateReadyBlock()}
})();
</script>`
}

export function generateWorkerBridgeScript(appId: string, version: string, locale: string): string {
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)}, { initialLocale: ${JSON.stringify(locale)} });
  window.superone.self = createSuperoneSelf(transport);
${generateReadyBlock()}
})();
</script>`
}

function wrapToolBridgeScript(appId: string, version: string, locale: string, toolObjectBody: string): string {
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)}, { initialLocale: ${JSON.stringify(locale)} });
  delete window.superone.ui.showPopover;

  window.superone.tool = ${toolObjectBody};
${generateReadyBlock()}
})();
</script>`
}

export function generateToolInterceptBridgeScript(
  appId: string,
  version: string,
  locale: string,
  ctx: { callId: string; toolName: string; initialData: unknown },
): string {
  const callIdJson = JSON.stringify(ctx.callId)
  const toolNameJson = JSON.stringify(ctx.toolName)
  const dataJson = JSON.stringify(ctx.initialData ?? null)
  const body = `(function() {
    var settled = false;
    return {
      phase: 'intercept',
      callId: ${callIdJson},
      toolName: ${toolNameJson},
      data: ${dataJson},
      submit: function(userInput) {
        if (settled) return;
        settled = true;
        transport.send('miniapp-tool-submit', { callId: ${callIdJson}, userInput: userInput || {} });
      },
      cancel: function(reason) {
        if (settled) return;
        settled = true;
        transport.send('miniapp-tool-cancel', { callId: ${callIdJson}, reason: reason || null });
      },
    };
  })()`
  return wrapToolBridgeScript(appId, version, locale, body)
}

export function generateToolResultBridgeScript(
  appId: string,
  version: string,
  locale: string,
  ctx: { callId: string; toolName: string; result: unknown },
): string {
  const callIdJson = JSON.stringify(ctx.callId)
  const toolNameJson = JSON.stringify(ctx.toolName)
  const dataJson = JSON.stringify(ctx.result ?? null)
  const body = `{
    phase: 'result',
    callId: ${callIdJson},
    toolName: ${toolNameJson},
    data: ${dataJson},
    close: function() {
      transport.send('miniapp-tool-result-close', { callId: ${callIdJson} });
    },
  }`
  return wrapToolBridgeScript(appId, version, locale, body)
}

export function generateStandaloneBridgeScript(
  appId: string,
  version: string,
  locale: string,
  ctx: { callId: string; toolName: string },
): string {
  const callIdJson = JSON.stringify(ctx.callId)
  const toolNameJson = JSON.stringify(ctx.toolName)
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)}, { initialLocale: ${JSON.stringify(locale)} });
  delete window.superone.ui.showPopover;

  window.superone.tool = {
    phase: 'standalone',
    callId: ${callIdJson},
    toolName: ${toolNameJson},
    args: null,
    result: null,
    error: null,
  };

  function fireResultEvent() {
    try {
      window.dispatchEvent(new CustomEvent('superone:tool-result', {
        detail: { result: window.superone.tool.result, error: window.superone.tool.error },
      }));
    } catch (e) { /* ignore */ }
  }

  // Use a standalone-specific message type so we don't collide with runtime's
  // 'miniapp-tool-call' handler (which serves panel iframes, registered inside
  // createSuperoneApi above and would fire first if it sees the same type).
  transport.on('miniapp-standalone-call', function(data) {
    if (!data) return;
    window.superone.tool.callId = data.callId;
    window.superone.tool.args = data.arguments || {};
    var handler = window.superone.tools._handlers && window.superone.tools._handlers.get(data.toolName);
    if (!handler) {
      window.superone.tool.error = "Tool '" + data.toolName + "' is not registered (call superone.tools.handle in your script).";
      transport.send('miniapp-tool-result', { callId: data.callId, error: window.superone.tool.error });
      fireResultEvent();
      return;
    }
    Promise.resolve().then(function() { return handler(data.arguments || {}); }).then(function(result) {
      window.superone.tool.result = result;
      transport.send('miniapp-tool-result', { callId: data.callId, result: result });
      fireResultEvent();
    }).catch(function(err) {
      var msg = (err && err.message) ? err.message : String(err);
      window.superone.tool.error = msg;
      transport.send('miniapp-tool-result', { callId: data.callId, error: msg });
      fireResultEvent();
    });
  });

  transport.on('miniapp-standalone-cached-result', function(data) {
    if (!data) return;
    window.superone.tool.callId = data.callId;
    window.superone.tool.args = data.arguments || null;
    if (data.error) window.superone.tool.error = data.error;
    else window.superone.tool.result = data.result;
    fireResultEvent();
  });

${generateReadyBlock()}
})();
</script>`
}
