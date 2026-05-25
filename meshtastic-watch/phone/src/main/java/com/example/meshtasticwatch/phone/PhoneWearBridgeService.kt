package com.example.meshtasticwatch.phone

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.example.meshtasticwatch.phone.model.WatchMessage
import com.example.meshtasticwatch.phone.model.WatchMetrics
import com.example.meshtasticwatch.phone.model.WatchNode
import com.example.meshtasticwatch.phone.model.WatchPosition
import com.geeksville.mesh.DataPacket
import com.geeksville.mesh.NodeInfo
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Foreground service that:
 *   1. Binds to the Meshtastic Android app's MeshService via AIDL
 *   2. Registers a BroadcastReceiver for Meshtastic events
 *   3. Serializes received data to JSON and pushes via Wearable Data Layer
 *
 * Data paths used:
 *   /meshtastic/messages  — rolling list of last 50 text messages
 *   /meshtastic/nodes     — map of all known nodes
 *   /meshtastic/position  — own-node GPS position
 *   /meshtastic/metrics   — own-node device telemetry
 */
class PhoneWearBridgeService : LifecycleService() {

    companion object {
        private const val TAG = "PhoneWearBridgeSvc"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "meshtastic_bridge"
        private const val CHANNEL_NAME = "Meshtastic Watch Bridge"
        const val MAX_MESSAGES = 50

        const val PATH_MESSAGES = "/meshtastic/messages"
        const val PATH_NODES = "/meshtastic/nodes"
        const val PATH_POSITION = "/meshtastic/position"
        const val PATH_METRICS = "/meshtastic/metrics"

        // DataPacket dataType values for text messages (Portnums.TEXT_MESSAGE_APP = 1)
        const val PORTNUM_TEXT_MESSAGE = 1
        // DataPacket dataType for telemetry (Portnums.TELEMETRY_APP = 67)
        const val PORTNUM_TELEMETRY = 67
        // DataPacket dataType for position (Portnums.POSITION_APP = 3)
        const val PORTNUM_POSITION = 3
    }

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
    private val positionAdapter by lazy { moshi.adapter(WatchPosition::class.java) }
    private val metricsAdapter by lazy { moshi.adapter(WatchMetrics::class.java) }

    private lateinit var dataClient: DataClient
    private lateinit var meshServiceConnection: MeshServiceConnection
    private lateinit var meshBroadcastReceiver: MeshBroadcastReceiver

    // Rolling message list (thread-safe)
    private val messages: CopyOnWriteArrayList<WatchMessage> = CopyOnWriteArrayList()
    // Node map keyed by node num
    private val nodeMap: ConcurrentHashMap<Int, WatchNode> = ConcurrentHashMap()
    // Own node position
    @Volatile private var ownNodeId: String = ""
    @Volatile private var isMeshConnected: Boolean = false

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "PhoneWearBridgeService onCreate")
        dataClient = Wearable.getDataClient(this)
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification("Starting Meshtastic Watch Bridge…"))
        setupMeshServiceConnection()
        setupBroadcastReceiver()
        bindToMeshtastic()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        Log.d(TAG, "onStartCommand")
        return Service.START_STICKY
    }

    override fun onBind(intent: Intent): IBinder? {
        super.onBind(intent)
        return null
    }

    override fun onDestroy() {
        Log.i(TAG, "PhoneWearBridgeService onDestroy")
        meshBroadcastReceiver.unregister(this)
        try {
            unbindService(meshServiceConnection)
        } catch (e: Exception) {
            Log.w(TAG, "Error unbinding from Meshtastic: ${e.message}")
        }
        super.onDestroy()
    }

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    private fun setupMeshServiceConnection() {
        meshServiceConnection = MeshServiceConnection(
            onConnected = { service ->
                Log.i(TAG, "MeshService connected — loading initial data")
                updateNotification("Connected to Meshtastic")
                isMeshConnected = true
                // Load initial node list
                val nodes = meshServiceConnection.getNodes()
                processInitialNodes(nodes)
                // Capture own node ID
                ownNodeId = meshServiceConnection.getMyId() ?: ""
                // Push initial node data to watch
                lifecycleScope.launch { pushNodes() }
            },
            onDisconnected = {
                Log.w(TAG, "MeshService disconnected")
                updateNotification("Meshtastic disconnected — waiting to reconnect…")
                isMeshConnected = false
            }
        )
    }

    private fun setupBroadcastReceiver() {
        meshBroadcastReceiver = MeshBroadcastReceiver(
            onMessageReceived = { packet -> handleDataPacket(packet) },
            onNodeChanged = { nodeInfo -> handleNodeChanged(nodeInfo) },
            onConnectionChanged = { connected ->
                isMeshConnected = connected
                if (connected) {
                    updateNotification("Connected to Meshtastic")
                } else {
                    updateNotification("Meshtastic radio disconnected")
                }
            }
        )
        meshBroadcastReceiver.register(this)
    }

    private fun bindToMeshtastic() {
        val intent = Intent().apply {
            setClassName("com.geeksville.mesh", "com.geeksville.mesh.service.MeshService")
        }
        try {
            val bound = bindService(intent, meshServiceConnection, BIND_AUTO_CREATE)
            if (!bound) {
                Log.w(TAG, "bindService returned false — is Meshtastic installed?")
                updateNotification("Meshtastic not found — install the app")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "SecurityException binding to Meshtastic: ${e.message}")
            updateNotification("Permission denied binding to Meshtastic")
        }
    }

    // -------------------------------------------------------------------------
    // Packet / Event Handlers
    // -------------------------------------------------------------------------

    private fun handleDataPacket(packet: DataPacket) {
        when (packet.dataType) {
            PORTNUM_TEXT_MESSAGE -> handleTextMessage(packet)
            PORTNUM_POSITION -> handlePositionPacket(packet)
            PORTNUM_TELEMETRY -> handleTelemetryPacket(packet)
            else -> Log.d(TAG, "Ignoring packet type ${packet.dataType}")
        }
    }

    private fun handleTextMessage(packet: DataPacket) {
        val text = try {
            packet.bytes?.toString(Charsets.UTF_8) ?: return
        } catch (e: Exception) {
            Log.e(TAG, "Failed to decode text message bytes: ${e.message}")
            return
        }
        val fromShortName = nodeMap.values
            .firstOrNull { it.id == packet.from }
            ?.shortName
            ?: packet.from

        val message = WatchMessage(
            id = packet.id,
            from = fromShortName,
            text = text,
            timestampMs = if (packet.time > 0) packet.time * 1000L else System.currentTimeMillis(),
            snr = packet.snr,
            rssi = packet.rssi
        )

        // Add to rolling list, trim to MAX_MESSAGES
        messages.add(message)
        while (messages.size > MAX_MESSAGES) {
            messages.removeAt(0)
        }

        Log.d(TAG, "Text message from ${message.from}: ${message.text.take(40)}")
        lifecycleScope.launch { pushMessages() }
    }

    private fun handlePositionPacket(packet: DataPacket) {
        // Only push position for own node
        if (packet.from != ownNodeId && ownNodeId.isNotEmpty()) {
            return
        }
        // Position data is typically embedded in the NodeInfo; update from node map
        val ownNode = nodeMap.values.firstOrNull { it.id == ownNodeId || ownNodeId.isEmpty() }
            ?: return

        val position = WatchPosition(
            latitude = ownNode.latitude,
            longitude = ownNode.longitude,
            altitude = ownNode.altitude,
            groundSpeed = ownNode.groundSpeed,
            timestampMs = System.currentTimeMillis()
        )
        Log.d(TAG, "Position update: lat=${position.latitude}, lon=${position.longitude}")
        lifecycleScope.launch { pushPosition(position) }
    }

    private fun handleTelemetryPacket(packet: DataPacket) {
        // Metrics come embedded in NodeInfo updates; cross-reference from node map
        val ownNode = nodeMap.values.firstOrNull { it.id == ownNodeId || ownNodeId.isEmpty() }
            ?: return

        val metrics = WatchMetrics(
            batteryLevel = ownNode.batteryLevel,
            voltage = ownNode.voltage,
            channelUtilization = ownNode.channelUtilization,
            airUtilTx = ownNode.airUtilTx,
            nodeId = ownNode.id,
            firmwareVersion = ownNode.firmwareVersion
        )
        Log.d(TAG, "Metrics update: battery=${metrics.batteryLevel}%")
        lifecycleScope.launch { pushMetrics(metrics) }
    }

    private fun handleNodeChanged(nodeInfo: NodeInfo) {
        val watchNode = nodeInfo.toWatchNode()
        nodeMap[nodeInfo.num] = watchNode

        // If own node ID not known yet, capture it
        if (ownNodeId.isEmpty()) {
            ownNodeId = meshServiceConnection.getMyId() ?: ""
        }

        // Push updated nodes list
        lifecycleScope.launch { pushNodes() }

        // If this is own node, also push position and metrics
        if (watchNode.id == ownNodeId || ownNodeId.isEmpty()) {
            val position = WatchPosition(
                latitude = watchNode.latitude,
                longitude = watchNode.longitude,
                altitude = watchNode.altitude,
                groundSpeed = watchNode.groundSpeed,
                timestampMs = System.currentTimeMillis()
            )
            val metrics = WatchMetrics(
                batteryLevel = watchNode.batteryLevel,
                voltage = watchNode.voltage,
                channelUtilization = watchNode.channelUtilization,
                airUtilTx = watchNode.airUtilTx,
                nodeId = watchNode.id,
                firmwareVersion = watchNode.firmwareVersion
            )
            lifecycleScope.launch {
                pushPosition(position)
                pushMetrics(metrics)
            }
        }
    }

    private fun processInitialNodes(nodes: List<NodeInfo>) {
        for (node in nodes) {
            nodeMap[node.num] = node.toWatchNode()
        }
        Log.i(TAG, "Loaded ${nodeMap.size} initial nodes")
    }

    // -------------------------------------------------------------------------
    // Wearable Data Layer Push
    // -------------------------------------------------------------------------

    suspend fun pushMessages() {
        try {
            val json = messagesAdapter.toJson(messages.toList())
            val request = PutDataMapRequest.create(PATH_MESSAGES).apply {
                dataMap.putString("json", json)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()
            dataClient.putDataItem(request).await()
            Log.d(TAG, "Pushed ${messages.size} messages to watch")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to push messages: ${e.message}")
        }
    }

    suspend fun pushNodes() {
        try {
            val json = nodesAdapter.toJson(nodeMap.values.toList())
            val request = PutDataMapRequest.create(PATH_NODES).apply {
                dataMap.putString("json", json)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()
            dataClient.putDataItem(request).await()
            Log.d(TAG, "Pushed ${nodeMap.size} nodes to watch")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to push nodes: ${e.message}")
        }
    }

    suspend fun pushPosition(position: WatchPosition) {
        try {
            val json = positionAdapter.toJson(position)
            val request = PutDataMapRequest.create(PATH_POSITION).apply {
                dataMap.putString("json", json)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()
            dataClient.putDataItem(request).await()
            Log.d(TAG, "Pushed position to watch: lat=${position.latitude}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to push position: ${e.message}")
        }
    }

    suspend fun pushMetrics(metrics: WatchMetrics) {
        try {
            val json = metricsAdapter.toJson(metrics)
            val request = PutDataMapRequest.create(PATH_METRICS).apply {
                dataMap.putString("json", json)
                dataMap.putLong("timestamp", System.currentTimeMillis())
            }.asPutDataRequest().setUrgent()
            dataClient.putDataItem(request).await()
            Log.d(TAG, "Pushed metrics to watch: battery=${metrics.batteryLevel}%")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to push metrics: ${e.message}")
        }
    }

    // -------------------------------------------------------------------------
    // Notification
    // -------------------------------------------------------------------------

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Background service bridging Meshtastic data to Wear OS watch"
        }
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(channel)
    }

    private fun buildNotification(contentText: String) =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Meshtastic Watch Bridge")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    private fun updateNotification(text: String) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    // -------------------------------------------------------------------------
    // NodeInfo → WatchNode conversion
    // -------------------------------------------------------------------------

    private fun NodeInfo.toWatchNode(): WatchNode = WatchNode(
        num = this.num,
        id = this.userId,
        longName = this.userLongName,
        shortName = this.userShortName,
        latitude = this.latitude,
        longitude = this.longitude,
        altitude = this.altitude,
        groundSpeed = this.groundSpeed,
        snr = this.snr,
        rssi = this.rssi,
        batteryLevel = this.batteryLevel,
        lastHeardSec = this.lastHeard,
        voltage = this.voltage,
        channelUtilization = this.channelUtil,
        airUtilTx = this.airUtilTx,
        firmwareVersion = this.firmwareVersion
    )
}
