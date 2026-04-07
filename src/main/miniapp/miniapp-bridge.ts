export function generateBridgeScript(appId: string): string {
  return `<script>
(function() {
  var handlers = new Map();
  var pendingFs = new Map();
  var pendingWatch = new Map();
  var watchCallbacks = new Map();
  var fsReqId = 0;
  var watchReqId = 0;
  var pendingGit = new Map();
  var gitReqId = 0;
  var gitHeadListeners = [];
  var darkModeListeners = [];
  var themeListeners = [];

  function bridgeFsCall(op, args) {
    return new Promise(function(resolve, reject) {
      var id = ++fsReqId;
      pendingFs.set(id, { resolve: resolve, reject: reject });
      parent.postMessage({ type: 'miniapp-fs-request', id: id, appId: '${appId}', op: op, args: args }, '*');
    });
  }

  function bridgeGitCall(op, args) {
    return new Promise(function(resolve, reject) {
      var id = ++gitReqId;
      pendingGit.set(id, { resolve: resolve, reject: reject });
      parent.postMessage({ type: 'miniapp-git-request', id: id, appId: '${appId}', op: op, args: args }, '*');
    });
  }

  var initCallbacks = [];
  var initData = null;

  window.superone = {
    tools: {
      handle: function(name, callback) {
        handlers.set(name, callback);
      }
    },
    onInit: function(callback) {
      if (initData !== null) { callback(initData); }
      else { initCallbacks.push(callback); }
    },
    fs: {
      readFile: function(path) { return bridgeFsCall('readFile', { path: path }); },
      readDir: function(path) { return bridgeFsCall('readDir', { path: path || '.' }); },
      writeFile: function(path, content) { return bridgeFsCall('writeFile', { path: path, content: content }); },
      exists: function(path) { return bridgeFsCall('exists', { path: path }); },
      glob: function(pattern) { return bridgeFsCall('glob', { pattern: pattern }); },
      watch: function(path, callback) {
        return new Promise(function(resolve, reject) {
          var id = ++watchReqId;
          pendingWatch.set(id, { resolve: resolve, reject: reject, callback: callback });
          parent.postMessage({ type: 'miniapp-fs-watch', id: id, path: path }, '*');
        });
      },
      unwatch: function(watchId) {
        watchCallbacks.delete(watchId);
        parent.postMessage({ type: 'miniapp-fs-unwatch', watchId: watchId }, '*');
      }
    },
    agent: {
      sendPrompt: function(text) {
        parent.postMessage({ type: 'miniapp-sendPrompt', text: text }, '*');
      }
    },
    git: {
      info: function() { return bridgeGitCall('info', {}); },
      branches: function() { return bridgeGitCall('branches', {}); },
      log: function(opts) { return bridgeGitCall('log', opts || {}); },
      status: function() { return bridgeGitCall('status', {}); },
      diff: function(path, staged) { return bridgeGitCall('diff', { path: path, staged: !!staged }); },
      show: function(ref, path) { return bridgeGitCall('show', { ref: ref, path: path }); },
      onHeadChange: function(cb) {
        gitHeadListeners.push(cb);
        return function() {
          var idx = gitHeadListeners.indexOf(cb);
          if (idx >= 0) gitHeadListeners.splice(idx, 1);
        };
      }
    },
    theme: {
      getVars: function() {
        var style = document.documentElement.style;
        var vars = {};
        for (var i = 0; i < style.length; i++) {
          var prop = style[i];
          if (prop.startsWith('--')) {
            vars[prop.slice(2)] = style.getPropertyValue(prop).trim();
          }
        }
        return vars;
      },
      onChange: function(cb) {
        themeListeners.push(cb);
        return function() {
          var idx = themeListeners.indexOf(cb);
          if (idx >= 0) themeListeners.splice(idx, 1);
        };
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

    if (data.type === 'miniapp-fs-watch-ack') {
      var pw = pendingWatch.get(data.id);
      if (pw) {
        pendingWatch.delete(data.id);
        if (data.error) {
          pw.reject(new Error(data.error));
        } else {
          watchCallbacks.set(data.watchId, pw.callback);
          pw.resolve(data.watchId);
        }
      }
    }

    if (data.type === 'miniapp-fs-watch-event') {
      var wcb = watchCallbacks.get(data.watchId);
      if (wcb) {
        wcb({ type: data.eventType, path: data.path });
      }
    }

    if (data.type === 'miniapp-git-response') {
      var pg = pendingGit.get(data.id);
      if (pg) {
        pendingGit.delete(data.id);
        if (data.error) {
          pg.reject(new Error(data.error));
        } else {
          pg.resolve(data.result);
        }
      }
    }

    if (data.type === 'miniapp-git-head-change') {
      gitHeadListeners.forEach(function(cb) { cb(); });
    }

    if (data.type === 'miniapp-inchat-init') {
      initData = data.data;
      initCallbacks.forEach(function(cb) { cb(initData); });
      initCallbacks = [];
    }

    if (data.type === 'miniapp-theme') {
      var root = document.documentElement;
      if (data.isDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      if (data.vars) {
        var keys = Object.keys(data.vars);
        for (var i = 0; i < keys.length; i++) {
          root.style.setProperty('--' + keys[i], data.vars[keys[i]]);
        }
      }
      darkModeListeners.forEach(function(cb) { cb(data.isDark); });
      themeListeners.forEach(function(cb) { cb(data.vars || {}); });
    }

  });

  function startResizeObserver() {
    if (!document.body) return;
    var lastH = 0;
    var pending = false;
    new ResizeObserver(function() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function() {
        pending = false;
        var h = document.body.offsetHeight;
        if (h > 0 && h !== lastH) {
          lastH = h;
          parent.postMessage({ type: 'miniapp-resize', appId: '${appId}', height: h }, '*');
        }
      });
    }).observe(document.body);
  }

  if (document.body) {
    startResizeObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startResizeObserver);
  }

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
