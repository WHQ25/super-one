// @ts-expect-error — ?raw import returns string
import runtimeSrc from '../../shared/miniapp-api-runtime.js?raw'

export function generateBridgeScript(appId: string, version: string): string {
  return `<script>
(function() {
  ${runtimeSrc}

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
  });

  window.superone = createSuperoneApi(transport, ${JSON.stringify(version)});
  startSuperoneResize(transport);

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    parent.postMessage({ type: 'miniapp-ready', appId: '${appId}' }, '*');
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      parent.postMessage({ type: 'miniapp-ready', appId: '${appId}' }, '*');
    });
  }
})();
</script>`
}
