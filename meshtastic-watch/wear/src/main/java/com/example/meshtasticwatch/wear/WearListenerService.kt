package com.example.meshtasticwatch.wear

import android.util.Log
import com.example.meshtasticwatch.wear.data.MeshRepository
import com.google.android.gms.wearable.CapabilityInfo
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/**
 * WearableListenerService that receives data and capability changes from the phone.
 *
 * Data paths handled:
 *   /meshtastic/messages  — updated message list JSON
 *   /meshtastic/nodes     — updated node list JSON
 *   /meshtastic/position  — updated own-node GPS position JSON
 *   /meshtastic/metrics   — updated own-node device metrics JSON
 *
 * Capability:
 *   meshtastic_phone_bridge — advertised by phone module when bridge is active.
 *     Used to set [MeshRepository.isPhoneConnected].
 */
class WearListenerService : WearableListenerService() {

    companion object {
        private const val TAG = "WearListenerService"

        const val PATH_MESSAGES = "/meshtastic/messages"
        const val PATH_NODES = "/meshtastic/nodes"
        const val PATH_POSITION = "/meshtastic/position"
        const val PATH_METRICS = "/meshtastic/metrics"

        const val CAPABILITY_PHONE_BRIDGE = "meshtastic_phone_bridge"
    }

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        Log.d(TAG, "onDataChanged: ${dataEvents.count} events")
        dataEvents.use { buffer ->
            for (event in buffer) {
                if (event.type == DataEvent.TYPE_CHANGED) {
                    val path = event.dataItem.uri.path ?: continue
                    Log.d(TAG, "Data changed at path: $path")
                    try {
                        val dataMap = DataMapItem.fromDataItem(event.dataItem).dataMap
                        val json = dataMap.getString("json") ?: continue
                        when (path) {
                            PATH_MESSAGES -> MeshRepository.updateMessagesFromJson(json)
                            PATH_NODES -> MeshRepository.updateNodesFromJson(json)
                            PATH_POSITION -> MeshRepository.updatePositionFromJson(json)
                            PATH_METRICS -> MeshRepository.updateMetricsFromJson(json)
                            else -> Log.d(TAG, "Unhandled data path: $path")
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing data event for path $path: ${e.message}")
                    }
                } else if (event.type == DataEvent.TYPE_DELETED) {
                    Log.d(TAG, "Data deleted at path: ${event.dataItem.uri.path}")
                }
            }
        }
    }

    override fun onCapabilityChanged(capabilityInfo: CapabilityInfo) {
        Log.d(TAG, "Capability changed: ${capabilityInfo.name}, nodes=${capabilityInfo.nodes}")
        if (capabilityInfo.name == CAPABILITY_PHONE_BRIDGE) {
            val connected = capabilityInfo.nodes.isNotEmpty()
            MeshRepository.setPhoneConnected(connected)
        }
    }
}
