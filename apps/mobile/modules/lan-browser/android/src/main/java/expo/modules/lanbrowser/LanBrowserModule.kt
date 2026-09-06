package expo.modules.lanbrowser

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.ArrayDeque

/**
 * Browses Bonjour for SuperOne desktops advertising on this network.
 *
 * `NsdManager.resolveService` handles exactly one resolve at a time and fails the
 * rest with FAILURE_ALREADY_ACTIVE, so discovered services queue here and resolve
 * one after another. Records are keyed by service name and republished as a whole
 * set, which is what the JS cache diffs against.
 */
class LanBrowserModule : Module() {
  private val lock = Any()
  private val records = LinkedHashMap<String, Map<String, Any?>>()
  private val pending = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private var discoveryListener: NsdManager.DiscoveryListener? = null

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
      enqueue(service)
    }

    override fun onServiceLost(service: NsdServiceInfo) {
      val changed = synchronized(lock) { records.remove(service.serviceName) != null }
      if (changed) publish()
    }
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
        val address = service.host?.hostAddress
        if (address != null) {
          synchronized(lock) {
            records[service.serviceName] = mapOf(
              "host" to address,
              "addresses" to listOf(address),
              "port" to service.port,
              "txt" to textRecord(service),
            )
          }
          publish()
        }
        drain()
      }
    })
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
