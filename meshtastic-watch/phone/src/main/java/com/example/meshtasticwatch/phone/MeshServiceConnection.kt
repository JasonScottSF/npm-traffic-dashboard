package com.example.meshtasticwatch.phone

import android.content.ComponentName
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import com.geeksville.mesh.IMeshService
import com.geeksville.mesh.NodeInfo

/**
 * ServiceConnection that manages the AIDL binding to the Meshtastic Android app's MeshService.
 *
 * Usage:
 *   val conn = MeshServiceConnection(
 *       onConnected = { service -> ... },
 *       onDisconnected = { ... }
 *   )
 *   context.bindService(meshServiceIntent, conn, Context.BIND_AUTO_CREATE)
 */
class MeshServiceConnection(
    private val onConnected: (IMeshService) -> Unit,
    private val onDisconnected: () -> Unit
) : ServiceConnection {

    companion object {
        private const val TAG = "MeshServiceConnection"
    }

    var meshService: IMeshService? = null
        private set

    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
        Log.i(TAG, "Meshtastic MeshService connected: $name")
        val service = IMeshService.Stub.asInterface(binder)
        meshService = service
        try {
            val myId = service.myId
            Log.i(TAG, "Connected to Meshtastic node ID: $myId")
        } catch (e: Exception) {
            Log.w(TAG, "Could not retrieve node ID on connect: ${e.message}")
        }
        onConnected(service)
    }

    override fun onServiceDisconnected(name: ComponentName?) {
        Log.w(TAG, "Meshtastic MeshService disconnected: $name")
        meshService = null
        onDisconnected()
    }

    override fun onBindingDied(name: ComponentName?) {
        Log.e(TAG, "Binding died for: $name")
        meshService = null
        onDisconnected()
    }

    override fun onNullBinding(name: ComponentName?) {
        Log.e(TAG, "Null binding returned for: $name — is Meshtastic installed?")
        meshService = null
        onDisconnected()
    }

    /**
     * Returns the list of all nodes known to the Meshtastic service, or empty list on error.
     */
    fun getNodes(): List<NodeInfo> {
        return try {
            meshService?.nodes?.filterNotNull() ?: emptyList()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get nodes: ${e.message}")
            emptyList()
        }
    }

    /**
     * Returns own node's NodeInfo, or null if not connected or on error.
     */
    fun getMyNodeInfo(): NodeInfo? {
        return try {
            meshService?.myNodeInfo
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get own node info: ${e.message}")
            null
        }
    }

    /**
     * Returns own node ID string (e.g. "!aabbccdd"), or null on error.
     */
    fun getMyId(): String? {
        return try {
            meshService?.myId
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get own node ID: ${e.message}")
            null
        }
    }
}
