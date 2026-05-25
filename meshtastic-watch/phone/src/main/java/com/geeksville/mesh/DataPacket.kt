package com.geeksville.mesh

import android.os.Parcel
import android.os.Parcelable

/**
 * Lightweight stub mirroring Meshtastic's DataPacket Parcelable.
 *
 * When using the official Meshtastic Android library via JitPack, this class
 * should be removed and the real DataPacket from the library used instead.
 * Verify artifact IDs at: https://github.com/meshtastic/Meshtastic-Android
 *
 * Fields matched to Meshtastic DataPacket as of recent releases:
 *   id        - packet ID (unique per packet)
 *   from      - originating node ID string (e.g. "!aabbccdd")
 *   to        - destination node ID string
 *   bytes     - raw payload bytes
 *   dataType  - numeric port number (Portnums value)
 *   snr       - signal-to-noise ratio
 *   rssi      - received signal strength indicator
 *   time      - Unix timestamp seconds
 */
class DataPacket() : Parcelable {
    var id: Int = 0
    var from: String = ""
    var to: String = ""
    var bytes: ByteArray? = null
    var dataType: Int = 0
    var snr: Float = 0f
    var rssi: Int = 0
    var time: Long = 0L

    constructor(parcel: Parcel) : this() {
        id = parcel.readInt()
        from = parcel.readString() ?: ""
        to = parcel.readString() ?: ""
        bytes = parcel.createByteArray()
        dataType = parcel.readInt()
        snr = parcel.readFloat()
        rssi = parcel.readInt()
        time = parcel.readLong()
    }

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeInt(id)
        parcel.writeString(from)
        parcel.writeString(to)
        parcel.writeByteArray(bytes)
        parcel.writeInt(dataType)
        parcel.writeFloat(snr)
        parcel.writeInt(rssi)
        parcel.writeLong(time)
    }

    override fun describeContents(): Int = 0

    companion object CREATOR : Parcelable.Creator<DataPacket> {
        override fun createFromParcel(parcel: Parcel): DataPacket = DataPacket(parcel)
        override fun newArray(size: Int): Array<DataPacket?> = arrayOfNulls(size)
    }
}
