# Meshtastic Watch — Wear OS Companion App

A Wear OS companion app that displays real-time data from your [Meshtastic](https://meshtastic.org/) mesh radio network on your Android smartwatch.

## Architecture

```
phone/ (Android foreground service)
  └── Binds to Meshtastic app via AIDL
  └── Receives broadcasts: messages, node updates, connection state
  └── Serializes data as JSON
  └── Pushes via Wearable Data Layer → watch

wear/ (Wear OS app)
  └── WearListenerService receives Data Layer updates
  └── MeshRepository holds state as StateFlows
  └── 4 screens: Messages, Nodes, GPS, Metrics
```

## Prerequisites

1. **Meshtastic Android app** — Install from [Google Play](https://play.google.com/store/apps/details?id=com.geeksville.mesh) or [F-Droid](https://meshtastic.org/docs/software/android/installation). The Meshtastic app must be installed on the same phone as the `phone` module.

2. **Paired Wear OS watch** — The watch must be paired to the phone and have the Google Wear OS app installed.

3. **Android SDK 26+** — Both modules target minSdk 26 (Android 8.0 / Wear OS 2.0).

4. **Meshtastic radio hardware** — Any supported Meshtastic-compatible LoRa device connected to the phone via BLE.

## Project Structure

```
meshtastic-watch/
├── build.gradle.kts            # Root build file
├── settings.gradle.kts         # Module includes + JitPack repo
├── gradle.properties
├── gradle/wrapper/
│   └── gradle-wrapper.properties  # Gradle 8.7
├── phone/                      # Phone companion module
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── aidl/com/geeksville/mesh/
│       │   ├── DataPacket.aidl
│       │   ├── NodeInfo.aidl
│       │   ├── IMeshService.aidl
│       │   └── IMeshServiceObserver.aidl
│       └── java/com/example/meshtasticwatch/phone/
│           ├── model/WatchModels.kt
│           ├── MeshServiceConnection.kt
│           ├── MeshBroadcastReceiver.kt
│           ├── PhoneWearBridgeService.kt
│           └── WearDataLayerListenerService.kt
└── wear/                       # Wear OS app module
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml
        └── java/com/example/meshtasticwatch/wear/
            ├── model/WatchModels.kt
            ├── data/MeshRepository.kt
            ├── WearListenerService.kt
            ├── viewmodel/MeshViewModel.kt
            ├── ui/theme/Theme.kt
            ├── ui/screens/MessagesScreen.kt
            ├── ui/screens/NodesScreen.kt
            ├── ui/screens/GpsScreen.kt
            ├── ui/screens/MetricsScreen.kt
            └── MainActivity.kt
```

## Building

### Debug build (both modules)

```bash
cd meshtastic-watch
./gradlew assembleDebug
```

APK output locations:
- Phone: `phone/build/outputs/apk/debug/phone-debug.apk`
- Watch: `wear/build/outputs/apk/debug/wear-debug.apk`

### Meshtastic library dependency

The `phone/build.gradle.kts` has commented-out JitPack dependencies for the official Meshtastic Android library:

```kotlin
// implementation("com.github.meshtastic.Meshtastic-Android:core-api:master-SNAPSHOT")
// implementation("com.github.meshtastic.Meshtastic-Android:core-model:master-SNAPSHOT")
```

If you want to use the real library instead of the lightweight AIDL stubs:

1. Verify artifact IDs at https://github.com/meshtastic/Meshtastic-Android
2. Uncomment the lines in `phone/build.gradle.kts`
3. Remove the stub files:
   - `phone/src/main/java/com/geeksville/mesh/DataPacket.kt`
   - `phone/src/main/java/com/geeksville/mesh/NodeInfo.kt`

The fallback stubs in `com.geeksville.mesh` package mirror the real Meshtastic Parcelable layout as of recent releases.

## Installing on Phone

```bash
# Install phone companion (run while phone is connected via ADB)
adb install phone/build/outputs/apk/debug/phone-debug.apk
```

## Sideloading to Watch

### Option 1: ADB over WiFi (watch and phone on same network)

1. Enable ADB on the watch: **Settings → Developer options → ADB debugging → on**
2. Enable ADB over WiFi: **Settings → Developer options → Debug over WiFi**
3. Note the watch IP address shown
4. Connect and install:

```bash
adb connect <watch-ip>:5555
adb -s <watch-ip>:5555 install wear/build/outputs/apk/debug/wear-debug.apk
```

### Option 2: ADB via paired phone (Wear OS 2+)

```bash
adb forward tcp:4444 localabstract:/adb-hub
adb connect localhost:4444
adb -s localhost:4444 install wear/build/outputs/apk/debug/wear-debug.apk
```

### Option 3: Android Studio

Open the project in Android Studio, select the `wear` run configuration, and choose your paired watch as the deployment target.

## Running the Phone Service

The `PhoneWearBridgeService` is a foreground service that must be started explicitly. You can start it from the phone by:

1. Opening a terminal and running:

```bash
adb shell am startservice \
  -n com.example.meshtasticwatch.phone/.PhoneWearBridgeService
```

2. Or start it programmatically from your own Activity:

```kotlin
val intent = Intent(this, PhoneWearBridgeService::class.java)
startForegroundService(intent)
```

Once running, the service shows a persistent notification: **"Meshtastic Watch Bridge running"**.

## Data Flow

```
Meshtastic radio
       │  BLE
       ▼
Meshtastic Android app (com.geeksville.mesh)
       │  AIDL + Broadcasts
       ▼
PhoneWearBridgeService (phone module)
       │  Wearable Data Layer (JSON)
       ▼  Paths:
       │    /meshtastic/messages
       │    /meshtastic/nodes
       │    /meshtastic/position
       │    /meshtastic/metrics
       ▼
WearListenerService (wear module)
       │  StateFlow updates
       ▼
MeshRepository → MeshViewModel → Compose UI
```

## Watch Screens

| Screen | Description |
|--------|-------------|
| **Home** | Menu with live count badges for each section |
| **Messages** | Rolling list of last 50 text messages with sender, time, SNR/RSSI |
| **Nodes** | All mesh nodes with battery, signal, last-heard; tap for position detail |
| **GPS** | Own node lat/lon/altitude/speed from last position packet |
| **Metrics** | Battery arc, channel utilization bars, firmware version |

## Troubleshooting

**"Meshtastic not found"** — The Meshtastic app is not installed or the package name changed. Verify `com.geeksville.mesh` in Play Store or F-Droid.

**No data on watch** — Ensure:
1. Phone service is running (check notification drawer)
2. Watch is connected to phone (Wear OS app shows connected)
3. ADB: `adb logcat -s PhoneWearBridgeSvc WearListenerService MeshRepository`

**AIDL binding fails** — The Meshtastic app may have updated its service interface. Check https://github.com/meshtastic/Meshtastic-Android and update the AIDL files in `phone/src/main/aidl/`.

**Nodes show all zeros** — The AIDL stub field order must match the real Meshtastic Parcelable. Consider using the JitPack library instead of the stubs.
