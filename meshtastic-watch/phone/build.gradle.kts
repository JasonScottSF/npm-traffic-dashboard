plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// NOTE: This project optionally depends on Meshtastic Android library modules published via JitPack.
// If you wish to use them, verify the exact artifact IDs at:
//   https://github.com/meshtastic/Meshtastic-Android
// Then uncomment the dependencies below. Typical artifact coordinates (verify before use):
//   implementation("com.github.meshtastic.Meshtastic-Android:core-api:master-SNAPSHOT")
//   implementation("com.github.meshtastic.Meshtastic-Android:core-model:master-SNAPSHOT")
// If those fail to resolve, the project uses its own lightweight data classes (see model/WatchModels.kt)
// and the AIDL definitions in src/main/aidl to communicate with the Meshtastic service.

android {
    namespace = "com.example.meshtasticwatch.phone"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.meshtasticwatch.phone"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        aidl = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.google.android.gms:play-services-wearable:18.1.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")
    implementation("androidx.lifecycle:lifecycle-service:2.8.3")
}
