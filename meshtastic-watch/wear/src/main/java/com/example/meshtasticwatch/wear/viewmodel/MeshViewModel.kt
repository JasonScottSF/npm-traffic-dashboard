package com.example.meshtasticwatch.wear.viewmodel

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.meshtasticwatch.wear.data.MeshRepository
import com.example.meshtasticwatch.wear.model.WatchMessage
import com.example.meshtasticwatch.wear.model.WatchMetrics
import com.example.meshtasticwatch.wear.model.WatchNode
import com.example.meshtasticwatch.wear.model.WatchPosition
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

/**
 * AndroidViewModel exposing Meshtastic data from [MeshRepository] to the UI.
 *
 * Also provides [refreshData] to request a fresh data push from the phone
 * companion by sending a message on the `/meshtastic/command/refresh` path.
 */
class MeshViewModel(application: Application) : AndroidViewModel(application) {

    companion object {
        private const val TAG = "MeshViewModel"
        const val PATH_COMMAND_REFRESH = "/meshtastic/command/refresh"
    }

    // -------------------------------------------------------------------------
    // Exposed StateFlows
    // -------------------------------------------------------------------------

    val messages: StateFlow<List<WatchMessage>> = MeshRepository.messages
    val nodes: StateFlow<List<WatchNode>> = MeshRepository.nodes
    val position: StateFlow<WatchPosition?> = MeshRepository.position
    val metrics: StateFlow<WatchMetrics?> = MeshRepository.metrics
    val isPhoneConnected: StateFlow<Boolean> = MeshRepository.isPhoneConnected

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /**
     * Sends a refresh command to the phone companion app.
     * The phone's [WearDataLayerListenerService] will re-query Meshtastic
     * and push fresh data for all paths.
     */
    fun refreshData() {
        viewModelScope.launch {
            try {
                val messageClient = Wearable.getMessageClient(getApplication())
                val nodes = Wearable.getNodeClient(getApplication()).connectedNodes.await()
                if (nodes.isEmpty()) {
                    Log.w(TAG, "No connected nodes — cannot send refresh command")
                    return@launch
                }
                for (node in nodes) {
                    messageClient.sendMessage(
                        node.id,
                        PATH_COMMAND_REFRESH,
                        ByteArray(0)
                    ).await()
                    Log.d(TAG, "Sent refresh command to node: ${node.displayName}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send refresh command: ${e.message}")
            }
        }
    }
}
