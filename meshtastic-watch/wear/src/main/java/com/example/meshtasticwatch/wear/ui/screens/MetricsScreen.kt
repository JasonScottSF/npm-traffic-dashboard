package com.example.meshtasticwatch.wear.ui.screens

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.rememberScalingLazyListState
import com.example.meshtasticwatch.wear.ui.theme.MeshtasticGreen
import com.example.meshtasticwatch.wear.ui.theme.WatchOnSurface
import com.example.meshtasticwatch.wear.ui.theme.WatchSurface
import com.example.meshtasticwatch.wear.ui.theme.WatchWarning
import com.example.meshtasticwatch.wear.viewmodel.MeshViewModel

/**
 * Displays device telemetry metrics for the own Meshtastic node.
 *
 * Shows:
 *   - Battery level with a circular progress arc
 *   - Battery voltage
 *   - Channel utilization horizontal bar
 *   - Air utilization TX horizontal bar
 *   - Firmware version
 *   - Node ID
 */
@Composable
fun MetricsScreen(viewModel: MeshViewModel) {
    val metrics by viewModel.metrics.collectAsState()
    val listState = rememberScalingLazyListState()

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            Text(
                text = "Device Metrics",
                style = MaterialTheme.typography.title3,
                color = MeshtasticGreen,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
            )
        }

        if (metrics == null) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No metrics yet",
                        style = MaterialTheme.typography.body2,
                        color = WatchOnSurface.copy(alpha = 0.6f),
                        textAlign = TextAlign.Center
                    )
                }
            }
        } else {
            val m = metrics!!

            item {
                BatteryArc(batteryLevel = m.batteryLevel)
            }

            item { Spacer(modifier = Modifier.height(4.dp)) }

            item {
                MetricRow(
                    label = "Voltage",
                    value = "${"%.2f".format(m.voltage)} V"
                )
            }

            item { Spacer(modifier = Modifier.height(6.dp)) }

            item {
                UtilizationBar(
                    label = "Ch Util",
                    percent = m.channelUtilization,
                    color = MeshtasticGreen
                )
            }

            item { Spacer(modifier = Modifier.height(4.dp)) }

            item {
                UtilizationBar(
                    label = "Air TX",
                    percent = m.airUtilTx,
                    color = MeshtasticGreen.copy(alpha = 0.75f)
                )
            }

            item { Spacer(modifier = Modifier.height(8.dp)) }

            item {
                MetricRow(label = "Node ID", value = m.nodeId)
            }
            item {
                MetricRow(label = "Firmware", value = m.firmwareVersion.ifEmpty { "unknown" })
            }
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}

/**
 * A circular arc showing battery percentage.
 * Arc goes from 7 o'clock to 5 o'clock (270° sweep).
 * Color transitions from green (high) to amber (low ≤ 20%).
 */
@Composable
private fun BatteryArc(batteryLevel: Int) {
    val arcColor = if (batteryLevel in 1..20) WatchWarning else MeshtasticGreen
    val trackColor = WatchSurface
    val label = if (batteryLevel == 101) "⚡" else "$batteryLevel%"
    val fraction = when {
        batteryLevel == 101 -> 1f
        batteryLevel <= 0 -> 0f
        else -> batteryLevel / 100f
    }

    Box(
        modifier = Modifier.size(80.dp),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val strokeWidth = 8.dp.toPx()
            val inset = strokeWidth / 2f
            val arcSize = Size(size.width - strokeWidth, size.height - strokeWidth)
            val topLeft = Offset(inset, inset)
            val startAngle = 135f
            val sweepTotal = 270f

            // Track (background arc)
            drawArc(
                color = trackColor,
                startAngle = startAngle,
                sweepAngle = sweepTotal,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
            )
            // Filled arc
            drawArc(
                color = arcColor,
                startAngle = startAngle,
                sweepAngle = sweepTotal * fraction,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = Stroke(width = strokeWidth, cap = StrokeCap.Round)
            )
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = label,
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = if (batteryLevel in 1..20) WatchWarning else MaterialTheme.colors.onBackground
            )
            Text(
                text = "battery",
                fontSize = 8.sp,
                color = WatchOnSurface.copy(alpha = 0.5f)
            )
        }
    }
}

/**
 * Horizontal progress bar for utilization metrics.
 */
@Composable
private fun UtilizationBar(label: String, percent: Float, color: Color) {
    val clamped = percent.coerceIn(0f, 100f)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(text = label, fontSize = 10.sp, color = WatchOnSurface.copy(alpha = 0.7f))
            Text(text = "${"%.1f".format(clamped)}%", fontSize = 10.sp, color = color)
        }
        Spacer(modifier = Modifier.height(2.dp))
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
        ) {
            // Track
            drawRoundRect(
                color = WatchSurface,
                size = size,
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx())
            )
            // Fill
            drawRoundRect(
                color = color,
                size = Size(size.width * (clamped / 100f), size.height),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx())
            )
        }
    }
}

@Composable
private fun MetricRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 1.dp),
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
