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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.items
import androidx.wear.compose.material.rememberScalingLazyListState
import com.example.meshtasticwatch.wear.model.WatchMessage
import com.example.meshtasticwatch.wear.ui.theme.MeshtasticGreen
import com.example.meshtasticwatch.wear.ui.theme.WatchOnSurface
import com.example.meshtasticwatch.wear.viewmodel.MeshViewModel

/**
 * Displays the rolling list of received Meshtastic text messages.
 *
 * Each row shows:
 *   - Sender short name in Meshtastic green
 *   - Message text (up to 2 lines)
 *   - Relative timestamp ("2m ago")
 *   - SNR and RSSI as small secondary text
 *
 * Empty state: "No messages yet"
 * Title includes message count.
 */
@Composable
fun MessagesScreen(viewModel: MeshViewModel) {
    val messages by viewModel.messages.collectAsState()
    val listState = rememberScalingLazyListState()

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            Text(
                text = "Messages (${messages.size})",
                style = MaterialTheme.typography.title3,
                color = MeshtasticGreen,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
            )
        }

        if (messages.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No messages yet",
                        style = MaterialTheme.typography.body2,
                        color = WatchOnSurface.copy(alpha = 0.6f)
                    )
                }
            }
        } else {
            // Newest messages first
            items(messages.sortedByDescending { it.timestampMs }) { message ->
                MessageRow(message = message)
            }
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}

@Composable
private fun MessageRow(message: WatchMessage) {
    Card(
        onClick = { /* view-only, no action */ },
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 2.dp)
    ) {
        Column(modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
            // Header row: sender + relative time
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = message.from,
                    color = MeshtasticGreen,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                Text(
                    text = relativeTime(message.timestampMs),
                    color = WatchOnSurface.copy(alpha = 0.6f),
                    fontSize = 10.sp
                )
            }

            Spacer(modifier = Modifier.height(2.dp))

            // Message text
            Text(
                text = message.text,
                style = MaterialTheme.typography.body2,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colors.onSurface
            )

            Spacer(modifier = Modifier.height(2.dp))

            // Signal quality
            Text(
                text = "SNR ${message.snr.formatSignal()} dB  RSSI ${message.rssi} dBm",
                fontSize = 9.sp,
                color = WatchOnSurface.copy(alpha = 0.5f)
            )
        }
    }
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Formats a timestamp as a human-readable relative time string.
 * Examples: "just now", "2m ago", "1h ago", "3d ago"
 */
fun relativeTime(timestampMs: Long): String {
    val diff = System.currentTimeMillis() - timestampMs
    if (diff < 0) return "now"
    val seconds = diff / 1000
    return when {
        seconds < 60 -> "just now"
        seconds < 3600 -> "${seconds / 60}m ago"
        seconds < 86400 -> "${seconds / 3600}h ago"
        else -> "${seconds / 86400}d ago"
    }
}

private fun Float.formatSignal(): String {
    return if (this == kotlin.math.floor(this).toFloat()) {
        this.toInt().toString()
    } else {
        "%.1f".format(this)
    }
}
