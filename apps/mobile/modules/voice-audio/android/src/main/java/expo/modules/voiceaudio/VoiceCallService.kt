package expo.modules.voiceaudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import android.os.Build

/** Started only by an explicit foreground call, after microphone permission. */
class VoiceCallService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel("voice-call", "Voice Calls", NotificationManager.IMPORTANCE_LOW))
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, "voice-call") else Notification.Builder(this)
    val notification = builder
      .setContentTitle("SuperOne").setContentText("Voice call in progress")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now).setOngoing(true)
      .setCategory(Notification.CATEGORY_CALL)
    if (launch != null) notification.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE))
    startForeground(417, notification.build())
    wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SuperOne:voice").apply { acquire() }
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_NOT_STICKY
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onDestroy() { wakeLock?.release(); wakeLock = null; super.onDestroy() }
}
