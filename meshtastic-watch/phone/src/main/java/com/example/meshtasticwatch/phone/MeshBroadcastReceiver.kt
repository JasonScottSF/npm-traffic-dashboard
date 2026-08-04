package com.example.meshtasticwatch.phone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.util.Log
import com.geeksville.mesh.DataPacket
import com.geeksville.mesh.NodeInfo

/**
 * BroadcastReceiver that listens for Meshtastic broadcasts and dispatches to callbacks.
 *
 * Handles three broadcast actions:
 *  - RECEIVE_FROMRADIO  : new DataPacket arrived from the mesh
 *  - NODE_CHANGE        : a NodeInfo was updated (new node seen or existing updated)
 *  - CONNECTION_CHANGED : BLE connection state changed between phone and radio hardware
 *
 * All deserialization is wrapped in try/catch to gracefully handle:
 *  - Meshtastic not installed (ClassNotFoundException for Parcelable classes)
 *  - Version mismatches between our stubs and the real Meshtastic Parcelable layout
 *  - SecurityExceptions when Meshtastic broadcasts are protected
 */
class MeshBroadcastReceiver(
    private val onMessageReceived: (DataPacket) -> Unit,
    private val onNodeChanged: (NodeInfo) -> Unit,
    private val onConnectionChanged: (Boolean) -> Unit
) : BroadcastReceiver() {

    companion object {
        private const val TAG = "MeshBroadcastReceiver"

        const val ACTION_RECEIVE_FROMRADIO = "com.geeksville.mesh.RECEIVE_FROMRADIO"
        const val ACTION_NODE_CHANGE = "com.geeksville.mesh.NODE_CHANGE"
        const val ACTION_CONNECTION_CHANGED = "com.geeksville.mesh.CONNECTION_CHANGED"

        const val EXTRA_PAYLOAD = "payload"
        const val EXTRA_NODE_INFO = "com.geeksville.mesh.NodeInfo"
        const val EXTRA_CONNECTED = "connected"

        /**
         * Creates an IntentFilter registering all three Meshtastic broadcast actions.
         */
        fun buildIntentFilter(): IntentFilter = IntentFilter().apply {
            addAction(ACTION_RECEIVE_FROMRADIO)
            addAction(ACTION_NODE_CHANGE)
            addAction(ACTION_CONNECTION_CHANGED)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_RECEIVE_FROMRADIO -> handleReceiveFromRadio(intent)
            ACTION_NODE_CHANGE -> handleNodeChange(intent)
            ACTION_CONNECTION_CHANGED -> handleConnectionChanged(intent)
            else -> Log.d(TAG, "Unhandled broadcast action: ${intent.action}")
        }
    }

    private fun handleReceiveFromRadio(intent: Intent) {
        try {
            val packet: DataPacket? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(EXTRA_PAYLOAD, DataPacket::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(EXTRA_PAYLOAD)
            }
            if (packet != null) {
                Log.d(TAG, "Received packet from ${packet.from}, dataType=${packet.dataType}")
                onMessageReceived(packet)
            } else {
                Log.w(TAG, "RECEIVE_FROMRADIO intent had no DataPacket extra")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException reading DataPacket — Meshtastic may not be installed: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to deserialize DataPacket from broadcast: ${e.message}")
        }
    }

    private fun handleNodeChange(intent: Intent) {
        try {
            val nodeInfo: NodeInfo? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(EXTRA_NODE_INFO, NodeInfo::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(EXTRA_NODE_INFO)
            }
            if (nodeInfo != null) {
                Log.d(TAG, "Node updated: num=${nodeInfo.num}, id=${nodeInfo.userId}")
                onNodeChanged(nodeInfo)
            } else {
                Log.w(TAG, "NODE_CHANGE intent had no NodeInfo extra")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException reading NodeInfo — Meshtastic may not be installed: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to deserialize NodeInfo from broadcast: ${e.message}")
        }
    }

    private fun handleConnectionChanged(intent: Intent) {
        try {
            val connected = intent.getBooleanExtra(EXTRA_CONNECTED, false)
            Log.i(TAG, "Meshtastic BLE connection changed: connected=$connected")
            onConnectionChanged(connected)
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException reading connection state: ${e.message}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse CONNECTION_CHANGED broadcast: ${e.message}")
        }
    }

    /**
     * Registers this receiver with the given context.
     * Call unregister() in the matching lifecycle teardown.
     */
    fun register(context: Context) {
        try {
            context.registerReceiver(this, buildIntentFilter())
            Log.i(TAG, "MeshBroadcastReceiver registered")
        } catch (e: SecurityException) {
            Log.e(TAG, "Could not register MeshBroadcastReceiver — Meshtastic not installed or permission denied: ${e.message}")
        }
    }

    /**
     * Unregisters this receiver from the given context.
     */
    fun unregister(context: Context) {
        try {
            context.unregisterReceiver(this)
            Log.i(TAG, "MeshBroadcastReceiver unregistered")
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "MeshBroadcastReceiver was not registered, ignoring unregister call")
        }
    }
}
