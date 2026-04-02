export function generateBridgeScript(appId: string): string {
  return `<script>
(function() {
  var handlers = new Map();
  var pendingFs = new Map();
  var fsReqId = 0;
  var darkModeListeners = [];

  function bridgeFsCall(op, args) {
    return new Promise(function(resolve, reject) {
      var id = ++fsReqId;
      pendingFs.set(id, { resolve: resolve, reject: reject });
      parent.postMessage({ type: 'miniapp-fs-request', id: id, appId: '${appId}', op: op, args: args }, '*');
    });
  }

  window.superone = {
    tools: {
      handle: function(name, callback) {
        handlers.set(name, callback);
      }
    },
    fs: {
      readFile: function(path) { return bridgeFsCall('readFile', { path: path }); },
      readDir: function(path) { return bridgeFsCall('readDir', { path: path || '.' }); },
      writeFile: function(path, content) { return bridgeFsCall('writeFile', { path: path, content: content }); },
      exists: function(path) { return bridgeFsCall('exists', { path: path }); },
      glob: function(pattern) { return bridgeFsCall('glob', { pattern: pattern }); }
    },
    agent: {
      sendPrompt: function(text) {
        parent.postMessage({ type: 'miniapp-sendPrompt', text: text }, '*');
      }
    },
    isDarkMode: function() {
      return document.documentElement.classList.contains('dark');
    },
    onDarkModeChange: function(cb) {
      darkModeListeners.push(cb);
      return function() {
        var idx = darkModeListeners.indexOf(cb);
        if (idx >= 0) darkModeListeners.splice(idx, 1);
      };
    }
  };

  window.addEventListener('message', function(e) {
    var data = e.data;
    if (!data || !data.type) return;

    if (data.type === 'miniapp-tool-call') {
      var handler = handlers.get(data.toolName);
      if (handler) {
        Promise.resolve().then(function() {
          return handler(data.arguments);
        }).then(function(result) {
          parent.postMessage({ type: 'miniapp-tool-result', callId: data.callId, result: result }, '*');
        }).catch(function(err) {
          parent.postMessage({ type: 'miniapp-tool-result', callId: data.callId, error: err.message || String(err) }, '*');
        });
      } else {
        parent.postMessage({ type: 'miniapp-tool-result', callId: data.callId, error: 'No handler for tool: ' + data.toolName }, '*');
      }
    }

    if (data.type === 'miniapp-fs-response') {
      var pending = pendingFs.get(data.id);
      if (pending) {
        pendingFs.delete(data.id);
        if (data.error) {
          pending.reject(new Error(data.error));
        } else {
          pending.resolve(data.result);
        }
      }
    }

    if (data.type === 'miniapp-dark-mode') {
      if (data.isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      darkModeListeners.forEach(function(cb) { cb(data.isDark); });
    }
  });

  parent.postMessage({ type: 'miniapp-ready', appId: '${appId}' }, '*');
})();
</script>`
}
