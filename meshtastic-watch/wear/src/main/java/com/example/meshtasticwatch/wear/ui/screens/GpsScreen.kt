package com.example.meshtasticwatch.wear.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.rememberScalingLazyListState
import com.example.meshtasticwatch.wear.model.WatchPosition
import com.example.meshtasticwatch.wear.ui.theme.MeshtasticGreen
import com.example.meshtasticwatch.wear.ui.theme.WatchOnSurface
import com.example.meshtasticwatch.wear.viewmodel.MeshViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Displays the current GPS position of the own Meshtastic node.
 *
 * Shows:
 *   - Latitude and longitude (large, high-precision)
 *   - Altitude in meters
 *   - Ground speed in km/h
 *   - Timestamp of last position fix
 *
 * This is a view-only display; data comes from the phone via Wearable Data Layer.
 */
@Composable
fun GpsScreen(viewModel: MeshViewModel) {
    val position by viewModel.position.collectAsState()
    val listState = rememberScalingLazyListState()

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            Text(
                text = "GPS Position",
                style = MaterialTheme.typography.title3,
                color = MeshtasticGreen,
                modifier = Modifier.padding(top = 8.dp, bottom = 8.dp)
            )
        }

        if (position == null) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = "No position data",
                            style = MaterialTheme.typography.body1,
                            color = WatchOnSurface.copy(alpha = 0.6f),
                            textAlign = TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Waiting for GPS fix…",
                            fontSize = 10.sp,
                            color = WatchOnSurface.copy(alpha = 0.4f),
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        } else {
            val pos = position!!

            item {
                GpsCoordinateBlock(pos)
            }

            item { Spacer(modifier = Modifier.height(6.dp)) }

            item {
                GpsDetailRow(label = "Altitude", value = "${pos.altitude} m")
            }
            item {
                GpsDetailRow(
                    label = "Speed",
                    value = "${(pos.groundSpeed * 3.6).toInt()} km/h"  // m/s → km/h
                )
            }
            item {
                GpsDetailRow(
                    label = "Updated",
                    value = formatTimestamp(pos.timestampMs)
                )
            }
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}

@Composable
private fun GpsCoordinateBlock(pos: WatchPosition) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Latitude
        LargeCoordinateText(
            label = "LAT",
            value = formatCoordinate(pos.latitude, isLatitude = true)
        )
        Spacer(modifier = Modifier.height(4.dp))
        // Longitude
        LargeCoordinateText(
            label = "LON",
            value = formatCoordinate(pos.longitude, isLatitude = false)
        )
    }
}

@Composable
private fun LargeCoordinateText(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = label,
            fontSize = 9.sp,
            color = MeshtasticGreen.copy(alpha = 0.7f),
            letterSpacing = 2.sp
        )
        Text(
            text = value,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colors.onBackground,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun GpsDetailRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            fontSize = 11.sp,
            color = WatchOnSurface.copy(alpha = 0.6f)
        )
        Text(
            text = value,
            fontSize = 11.sp,
            color = WatchOnSurface,
            fontWeight = FontWeight.Medium
        )
    }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Formats a latitude or longitude as degrees with N/S/E/W suffix.
 * Example: "37.774929°N", "-122.419416°W" → "122.419416°W"
 */
private fun formatCoordinate(value: Double, isLatitude: Boolean): String {
    val abs = kotlin.math.abs(value)
    val suffix = if (isLatitude) {
        if (value >= 0) "N" else "S"
    } else {
        if (value >= 0) "E" else "W"
    }
    return "${"%.6f".format(abs)}°$suffix"
}

private fun formatTimestamp(ms: Long): String {
    val sdf = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
    return sdf.format(Date(ms))
}
