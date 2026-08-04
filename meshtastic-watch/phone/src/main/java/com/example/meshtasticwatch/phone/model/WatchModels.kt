package com.example.meshtasticwatch.phone.model

/**
 * Represents a text message received from the Meshtastic mesh network.
 */
data class WatchMessage(
    val id: Int,
    val from: String,       // node short name or ID
    val text: String,
    val timestampMs: Long,
    val snr: Float,
    val rssi: Int
)

/**
 * Represents a node on the Meshtastic mesh network.
 * batteryLevel: 0-100 for battery percentage, 101 means plugged in (charging).
 * lastHeardSec: Unix epoch seconds when this node last transmitted.
 * voltage: battery voltage in volts (from device telemetry).
 * channelUtilization: channel utilization percentage 0.0–100.0.
 * airUtilTx: air utilization TX percentage 0.0–100.0.
 * firmwareVersion: firmware version string for own node; empty for remote nodes.
 * groundSpeed: GPS ground speed in m/s (0 if unknown).
 */
data class WatchNode(
    val num: Int,
    val id: String,
    val longName: String,
    val shortName: String,
    val latitude: Double,
    val longitude: Double,
    val altitude: Int,
    val groundSpeed: Int = 0,
    val snr: Float,
    val rssi: Int,
    val batteryLevel: Int,        // 0-100, 101 = plugged in
    val lastHeardSec: Long,       // unix seconds
    val voltage: Float = 0f,
    val channelUtilization: Float = 0f,
    val airUtilTx: Float = 0f,
    val firmwareVersion: String = ""
)

/**
 * Represents the current GPS position of our own node.
 */
data class WatchPosition(
    val latitude: Double,
    val longitude: Double,
    val altitude: Int,
    val groundSpeed: Int,
    val timestampMs: Long
)

/**
 * Telemetry/device metrics from our own node.
 * channelUtilization and airUtilTx are percentages 0.0-100.0.
 */
data class WatchMetrics(
    val batteryLevel: Int,
    val voltage: Float,
    val channelUtilization: Float,
    val airUtilTx: Float,
    val nodeId: String,
    val firmwareVersion: String
)
