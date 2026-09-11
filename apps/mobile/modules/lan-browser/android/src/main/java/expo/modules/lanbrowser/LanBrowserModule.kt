package expo.modules.lanbrowser

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.ArrayDeque
import java.util.concurrent.Executor

/**
 * Browses Bonjour for SuperOne desktops advertising on this network.
 *
 * The desktop's LAN port is ephemeral, so a desktop that restarts keeps its
 * service name and changes its SRV record. `DiscoveryListener` reports a name
 * once and never again, and a one-shot `resolveService` answers from the
 * system's mDNS cache — which can still hold the port from before the restart.
 * On API 34+ each found service therefore gets a `ServiceInfoCallback`, which
 * keeps delivering `onServiceUpdated` as the real answers come in. Older
 * releases fall back to the one-shot resolve, serialised because
 * `resolveService` handles one request at a time and fails the rest with
 * FAILURE_ALREADY_ACTIVE. Records are keyed by service name and republished as
 * a whole set, which is what the JS cache diffs against.
 */
class LanBrowserModule : Module() {
  private val lock = Any()
  private val records = LinkedHashMap<String, Map<String, Any?>>()
  private val pending = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private var discoveryListener: NsdManager.DiscoveryListener? = null
  /** API 34+: the live resolve per discovered service, keyed by service name. */
  private val infoCallbacks = HashMap<String, NsdManager.ServiceInfoCallback>()
  private val executor = Executor { it.run() }

  private val nsdManager: NsdManager
    get() = (appContext.reactContext ?: throw Exceptions.ReactContextLost())
      .getSystemService(Context.NSD_SERVICE) as NsdManager

  override fun definition() = ModuleDefinition {
    Name("SuperOneLanBrowser")
    Events("onServicesChanged")

    AsyncFunction("start") { serviceType: String ->
      synchronized(lock) {
        if (discoveryListener != null) return@AsyncFunction
        val listener = createDiscoveryListener()
        discoveryListener = listener
        nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
      }
    }

    AsyncFunction("stop") {
      teardown()
    }

    OnDestroy {
      teardown()
    }
  }

  private fun teardown() {
    synchronized(lock) {
      discoveryListener?.let {
        runCatching { nsdManager.stopServiceDiscovery(it) }
      }
      discoveryListener = null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        for (callback in infoCallbacks.values) {
          runCatching { nsdManager.unregisterServiceInfoCallback(callback) }
        }
      }
      infoCallbacks.clear()
      pending.clear()
      resolving = false
      records.clear()
    }
  }

  private fun createDiscoveryListener() = object : NsdManager.DiscoveryListener {
    override fun onDiscoveryStarted(serviceType: String) = Unit

    override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
      teardown()
    }

    override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) = Unit

    override fun onDiscoveryStopped(serviceType: String) = Unit

    override fun onServiceFound(service: NsdServiceInfo) {
      watch(service)
    }

    override fun onServiceLost(service: NsdServiceInfo) {
      val name = service.serviceName
      val changed = synchronized(lock) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
          infoCallbacks.remove(name)?.let { runCatching { nsdManager.unregisterServiceInfoCallback(it) } }
        }
        records.remove(name) != null
      }
      if (changed) publish()
    }
  }

  private fun watch(service: NsdServiceInfo) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return enqueue(service)
    val name = service.serviceName
    val callback = object : NsdManager.ServiceInfoCallback {
      override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
        synchronized(lock) { infoCallbacks.remove(name) }
        enqueue(service)
      }

      override fun onServiceUpdated(serviceInfo: NsdServiceInfo) {
        store(serviceInfo)
      }

      /** The callback stays registered; `onServiceUpdated` fires again if it returns. */
      override fun onServiceLost() {
        val changed = synchronized(lock) { records.remove(name) != null }
        if (changed) publish()
      }

      override fun onServiceInfoCallbackUnregistered() = Unit
    }
    synchronized(lock) {
      if (discoveryListener == null) return
      infoCallbacks.remove(name)?.let { runCatching { nsdManager.unregisterServiceInfoCallback(it) } }
      infoCallbacks[name] = callback
    }
    nsdManager.registerServiceInfoCallback(service, executor, callback)
  }

  private fun enqueue(service: NsdServiceInfo) {
    synchronized(lock) {
      pending.addLast(service)
      if (resolving) return
      resolving = true
    }
    drain()
  }

  private fun drain() {
    val next = synchronized(lock) {
      val candidate = pending.pollFirst()
      if (candidate == null) resolving = false
      candidate
    } ?: return
    nsdManager.resolveService(next, object : NsdManager.ResolveListener {
      override fun onResolveFailed(service: NsdServiceInfo, errorCode: Int) {
        drain()
      }

      override fun onServiceResolved(service: NsdServiceInfo) {
        store(service)
        drain()
      }
    })
  }

  private fun store(service: NsdServiceInfo) {
    val addresses = hostAddresses(service)
    val host = addresses.firstOrNull() ?: return
    synchronized(lock) {
      if (discoveryListener == null) return
      records[service.serviceName] = mapOf(
        "host" to host,
        "addresses" to addresses,
        "port" to service.port,
        "txt" to textRecord(service),
      )
    }
    publish()
  }

  /** Every resolved address, without the `%wlan0` zone a scoped IPv6 carries; JS picks IPv4 first. */
  private fun hostAddresses(service: NsdServiceInfo): List<String> {
    val raw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      service.hostAddresses.mapNotNull { it.hostAddress }
    } else {
      listOfNotNull(service.host?.hostAddress)
    }
    return raw.map { it.substringBefore('%') }
  }

  /** TXT values arrive as raw bytes; the desktop writes them as UTF-8. */
  private fun textRecord(service: NsdServiceInfo): Map<String, String> {
    val attributes = service.attributes ?: return emptyMap()
    return attributes.entries.mapNotNull { (key, value) ->
      value?.let { key to String(it, Charsets.UTF_8) }
    }.toMap()
  }

  private fun publish() {
    val services = synchronized(lock) { records.values.toList() }
    sendEvent("onServicesChanged", mapOf("services" to services))
  }
}
