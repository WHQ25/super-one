// @ts-expect-error — ?raw import returns string
import runtimeSrc from '../../shared/miniapp-api-runtime.js?raw'

function generateTransportBlock(appId: string): string {
  return `${runtimeSrc}

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

function generateReadyBlock(appId: string): string {
  return `
  startSuperoneResize(transport);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    parent.postMessage({ type: 'miniapp-ready', appId: '${appId}' }, '*');
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      parent.postMessage({ type: 'miniapp-ready', appId: '${appId}' }, '*');
    });
  }`
}

export function generatePopoverBridgeScript(appId: string, version: string, initialData: unknown): string {
  const dataJson = JSON.stringify(initialData ?? null)
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)});
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
${generateReadyBlock(appId)}
})();
</script>`
}

export function generateBridgeScript(appId: string, version: string): string {
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)});
${generateReadyBlock(appId)}
})();
</script>`
}

function wrapToolBridgeScript(appId: string, version: string, toolObjectBody: string): string {
  return `<script>
(function() {
  ${generateTransportBlock(appId)}

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)});
  delete window.superone.ui.showPopover;

  window.superone.tool = ${toolObjectBody};
${generateReadyBlock(appId)}
})();
</script>`
}

export function generateToolInterceptBridgeScript(
  appId: string,
  version: string,
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
  return wrapToolBridgeScript(appId, version, body)
}

export function generateToolResultBridgeScript(
  appId: string,
  version: string,
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
  return wrapToolBridgeScript(appId, version, body)
}
