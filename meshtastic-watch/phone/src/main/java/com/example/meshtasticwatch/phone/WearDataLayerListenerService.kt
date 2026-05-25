package com.example.meshtasticwatch.phone

import android.content.Intent
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * WearableListenerService that receives messages from the Wear OS watch.
 *
 * Currently handles:
 *   /meshtastic/command/refresh — watch is requesting a full data refresh.
 *     Response: re-queries Meshtastic service and pushes fresh node, position,
 *     message, and metrics data to the watch.
 *
 * This service is started automatically by the Wearable Data Layer when a
 * matching message arrives, even if PhoneWearBridgeService is not running.
 */
class WearDataLayerListenerService : WearableListenerService() {

    companion object {
        private const val TAG = "WearDataLayerListener"
        const val PATH_COMMAND_REFRESH = "/meshtastic/command/refresh"
    }

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onDestroy() {
        serviceScope.cancel()
        super.onDestroy()
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        Log.d(TAG, "Message received: path=${messageEvent.path} from=${messageEvent.sourceNodeId}")

        when (messageEvent.path) {
            PATH_COMMAND_REFRESH -> handleRefreshCommand(messageEvent.sourceNodeId)
            else -> Log.d(TAG, "Unhandled message path: ${messageEvent.path}")
        }
    }

    /**
     * Handles a refresh request from the watch.
     *
     * Strategy:
     *   1. If PhoneWearBridgeService is already running, it will handle ongoing updates.
     *      Start it to ensure it's running, and trigger a push by broadcasting an intent.
     *   2. The bridge service's onStartCommand handles idempotent starts (START_STICKY).
     */
    private fun handleRefreshCommand(sourceNodeId: String) {
        Log.i(TAG, "Refresh requested by watch node: $sourceNodeId")
        serviceScope.launch {
            try {
                // Ensure PhoneWearBridgeService is running — it will push data when connected
                val intent = Intent(this@WearDataLayerListenerService, PhoneWearBridgeService::class.java)
                startForegroundService(intent)
                Log.i(TAG, "PhoneWearBridgeService start requested in response to watch refresh")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to start PhoneWearBridgeService on refresh: ${e.message}")
            }
        }
    }
}
