package com.example.meshtasticwatch.wear.data

import android.util.Log
import com.example.meshtasticwatch.wear.model.WatchMessage
import com.example.meshtasticwatch.wear.model.WatchMetrics
import com.example.meshtasticwatch.wear.model.WatchNode
import com.example.meshtasticwatch.wear.model.WatchPosition
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Singleton repository that holds all Meshtastic data flowing from the phone.
 *
 * Data is updated by [com.example.meshtasticwatch.wear.WearListenerService] whenever
 * the Wearable Data Layer delivers updated data from the phone module.
 *
 * All public StateFlows are safe to observe from the UI thread.
 */
object MeshRepository {

    private const val TAG = "MeshRepository"

    // -------------------------------------------------------------------------
    // Moshi adapters
    // -------------------------------------------------------------------------

    private val moshi: Moshi = Moshi.Builder()
        .addLast(KotlinJsonAdapterFactory())
        .build()

    private val messagesAdapter by lazy {
        moshi.adapter<List<WatchMessage>>(
            Types.newParameterizedType(List::class.java, WatchMessage::class.java)
        )
    }

    private val nodesAdapter by lazy {
        moshi.adapter<List<WatchNode>>(
            Types.newParameterizedType(List::class.java, WatchNode::class.java)
        )
    }

    private val positionAdapter by lazy {
        moshi.adapter(WatchPosition::class.java)
    }

    private val metricsAdapter by lazy {
        moshi.adapter(WatchMetrics::class.java)
    }

    // -------------------------------------------------------------------------
    // State flows
    // -------------------------------------------------------------------------

    private val _messages = MutableStateFlow<List<WatchMessage>>(emptyList())
    val messages: StateFlow<List<WatchMessage>> = _messages.asStateFlow()

    private val _nodes = MutableStateFlow<List<WatchNode>>(emptyList())
    val nodes: StateFlow<List<WatchNode>> = _nodes.asStateFlow()

    private val _position = MutableStateFlow<WatchPosition?>(null)
    val position: StateFlow<WatchPosition?> = _position.asStateFlow()

    private val _metrics = MutableStateFlow<WatchMetrics?>(null)
    val metrics: StateFlow<WatchMetrics?> = _metrics.asStateFlow()

    private val _isPhoneConnected = MutableStateFlow(false)
    val isPhoneConnected: StateFlow<Boolean> = _isPhoneConnected.asStateFlow()

    // -------------------------------------------------------------------------
    // Update methods — called by WearListenerService on the listener thread
    // -------------------------------------------------------------------------

    /**
     * Updates the message list from a JSON string produced by the phone module.
     */
    fun updateMessagesFromJson(json: String) {
        try {
            val list = messagesAdapter.fromJson(json) ?: return
            _messages.value = list
            Log.d(TAG, "Updated ${list.size} messages")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse messages JSON: ${e.message}")
        }
    }

    /**
     * Updates the node list from a JSON string produced by the phone module.
     */
    fun updateNodesFromJson(json: String) {
        try {
            val list = nodesAdapter.fromJson(json) ?: return
            _nodes.value = list
            Log.d(TAG, "Updated ${list.size} nodes")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse nodes JSON: ${e.message}")
        }
    }

    /**
     * Updates the own-node position from a JSON string produced by the phone module.
     */
    fun updatePositionFromJson(json: String) {
        try {
            val pos = positionAdapter.fromJson(json) ?: return
            _position.value = pos
            Log.d(TAG, "Updated position: lat=${pos.latitude}, lon=${pos.longitude}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse position JSON: ${e.message}")
        }
    }

    /**
     * Updates device metrics from a JSON string produced by the phone module.
     */
    fun updateMetricsFromJson(json: String) {
        try {
            val m = metricsAdapter.fromJson(json) ?: return
            _metrics.value = m
            Log.d(TAG, "Updated metrics: battery=${m.batteryLevel}%")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse metrics JSON: ${e.message}")
        }
    }

    /**
     * Sets whether the phone companion is currently reachable via the Data Layer.
     */
    fun setPhoneConnected(connected: Boolean) {
        _isPhoneConnected.value = connected
        Log.i(TAG, "Phone connected: $connected")
    }
}
