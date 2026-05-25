package com.geeksville.mesh

import android.os.Parcel
import android.os.Parcelable

/**
 * Lightweight stub mirroring Meshtastic's NodeInfo Parcelable.
 *
 * When using the official Meshtastic Android library via JitPack, this class
 * should be removed and the real NodeInfo from the library used instead.
 * Verify artifact IDs at: https://github.com/meshtastic/Meshtastic-Android
 *
 * Fields matched to Meshtastic NodeInfo as of recent releases:
 *   num           - node number (integer)
 *   user          - MeshUser sub-object (id, longName, shortName)
 *   position      - Position sub-object (latitude, longitude, altitude, groundSpeed, time)
 *   snr           - last heard SNR
 *   rssi          - last heard RSSI
 *   lastHeard     - Unix timestamp seconds of last reception
 *   batteryLevel  - 0-100 or 101 (plugged in)
 *   voltage       - battery voltage in volts
 *   channelUtil   - channel utilization 0.0-100.0
 *   airUtilTx     - air utilization TX 0.0-100.0
 *   firmwareVersion - firmware version string
 */
class NodeInfo() : Parcelable {
    var num: Int = 0
    var userId: String = ""
    var userLongName: String = ""
    var userShortName: String = ""
    var latitude: Double = 0.0
    var longitude: Double = 0.0
    var altitude: Int = 0
    var groundSpeed: Int = 0
    var positionTime: Long = 0L
    var snr: Float = 0f
    var rssi: Int = 0
    var lastHeard: Long = 0L
    var batteryLevel: Int = 0
    var voltage: Float = 0f
    var channelUtil: Float = 0f
    var airUtilTx: Float = 0f
    var firmwareVersion: String = ""

    constructor(parcel: Parcel) : this() {
        num = parcel.readInt()
        userId = parcel.readString() ?: ""
        userLongName = parcel.readString() ?: ""
        userShortName = parcel.readString() ?: ""
        latitude = parcel.readDouble()
        longitude = parcel.readDouble()
        altitude = parcel.readInt()
        groundSpeed = parcel.readInt()
        positionTime = parcel.readLong()
        snr = parcel.readFloat()
        rssi = parcel.readInt()
        lastHeard = parcel.readLong()
        batteryLevel = parcel.readInt()
        voltage = parcel.readFloat()
        channelUtil = parcel.readFloat()
        airUtilTx = parcel.readFloat()
        firmwareVersion = parcel.readString() ?: ""
    }

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeInt(num)
        parcel.writeString(userId)
        parcel.writeString(userLongName)
        parcel.writeString(userShortName)
        parcel.writeDouble(latitude)
        parcel.writeDouble(longitude)
        parcel.writeInt(altitude)
        parcel.writeInt(groundSpeed)
        parcel.writeLong(positionTime)
        parcel.writeFloat(snr)
        parcel.writeInt(rssi)
        parcel.writeLong(lastHeard)
        parcel.writeInt(batteryLevel)
        parcel.writeFloat(voltage)
        parcel.writeFloat(channelUtil)
        parcel.writeFloat(airUtilTx)
        parcel.writeString(firmwareVersion)
    }

    override fun describeContents(): Int = 0

    companion object CREATOR : Parcelable.Creator<NodeInfo> {
        override fun createFromParcel(parcel: Parcel): NodeInfo = NodeInfo(parcel)
        override fun newArray(size: Int): Array<NodeInfo?> = arrayOfNulls(size)
    }
}
