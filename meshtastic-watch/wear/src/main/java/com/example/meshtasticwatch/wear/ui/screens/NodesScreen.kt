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
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.dialog.Dialog
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.items
import androidx.wear.compose.material.rememberScalingLazyListState
import com.example.meshtasticwatch.wear.model.WatchNode
import com.example.meshtasticwatch.wear.ui.theme.MeshtasticGreen
import com.example.meshtasticwatch.wear.ui.theme.WatchOnSurface
import com.example.meshtasticwatch.wear.ui.theme.WatchWarning
import com.example.meshtasticwatch.wear.viewmodel.MeshViewModel

/**
 * Displays all known Meshtastic nodes on the mesh network.
 *
 * Each row shows:
 *   - Short name in green + long name
 *   - Battery level with indicator (low battery shown in amber)
 *   - SNR and RSSI
 *   - "Xm ago" relative time since last heard
 *
 * Tapping a node shows a detail dialog with full position information.
 */
@Composable
fun NodesScreen(viewModel: MeshViewModel) {
    val nodes by viewModel.nodes.collectAsState()
    val listState = rememberScalingLazyListState()
    var selectedNode by remember { mutableStateOf<WatchNode?>(null) }

    // Sort by most recently heard first
    val sortedNodes = nodes.sortedByDescending { it.lastHeardSec }

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            Text(
                text = "Nodes (${nodes.size})",
                style = MaterialTheme.typography.title3,
                color = MeshtasticGreen,
                modifier = Modifier.padding(top = 8.dp, bottom = 4.dp)
            )
        }

        if (sortedNodes.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No nodes seen yet",
                        style = MaterialTheme.typography.body2,
                        color = WatchOnSurface.copy(alpha = 0.6f)
                    )
                }
            }
        } else {
            items(sortedNodes) { node ->
                NodeRow(
                    node = node,
                    onClick = { selectedNode = node }
                )
            }
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }

    // Node detail dialog
    selectedNode?.let { node ->
        NodeDetailDialog(
            node = node,
            onDismiss = { selectedNode = null }
        )
    }
}

@Composable
private fun NodeRow(node: WatchNode, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 2.dp)
    ) {
        Column(modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)) {
            // Name row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = node.shortName,
                        color = MeshtasticGreen,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        maxLines = 1
                    )
                    Text(
                        text = "  ${node.longName}",
                        fontSize = 11.sp,
                        color = WatchOnSurface.copy(alpha = 0.8f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                // Battery
                Text(
                    text = batteryLabel(node.batteryLevel),
                    fontSize = 10.sp,
                    color = if (node.batteryLevel in 1..20) WatchWarning else WatchOnSurface.copy(alpha = 0.7f)
                )
            }

            Spacer(modifier = Modifier.height(2.dp))

            // Signal + last heard
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = "SNR ${"%.1f".format(node.snr)} dB  RSSI ${node.rssi} dBm",
                    fontSize = 9.sp,
                    color = WatchOnSurface.copy(alpha = 0.5f)
                )
                Text(
                    text = relativeTime(node.lastHeardSec * 1000L),
                    fontSize = 9.sp,
                    color = WatchOnSurface.copy(alpha = 0.5f)
                )
            }
        }
    }
}

@Composable
private fun NodeDetailDialog(node: WatchNode, onDismiss: () -> Unit) {
    Dialog(
        showDialog = true,
        onDismissRequest = onDismiss
    ) {
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            item {
                Text(
                    text = node.shortName,
                    style = MaterialTheme.typography.title2,
                    color = MeshtasticGreen,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
            item {
                Text(
                    text = node.longName,
                    style = MaterialTheme.typography.body2,
                    color = WatchOnSurface.copy(alpha = 0.8f)
                )
            }
            item { Spacer(modifier = Modifier.height(4.dp)) }
            item {
                DetailRow("ID", node.id)
            }
            if (node.latitude != 0.0 || node.longitude != 0.0) {
                item { DetailRow("Lat", "%.6f".format(node.latitude)) }
                item { DetailRow("Lon", "%.6f".format(node.longitude)) }
                item { DetailRow("Alt", "${node.altitude} m") }
            } else {
                item {
                    Text(
                        text = "No position available",
                        fontSize = 10.sp,
                        color = WatchOnSurface.copy(alpha = 0.5f)
                    )
                }
            }
            item { DetailRow("Battery", batteryLabel(node.batteryLevel)) }
            item { DetailRow("SNR", "${"%.1f".format(node.snr)} dB") }
            item { DetailRow("RSSI", "${node.rssi} dBm") }
            item { DetailRow("Last heard", relativeTime(node.lastHeardSec * 1000L)) }
            item { Spacer(modifier = Modifier.height(4.dp)) }
            item {
                Button(
                    onClick = onDismiss,
                    modifier = Modifier.size(48.dp)
                ) {
                    Text("OK", fontSize = 12.sp)
                }
            }
            item { Spacer(modifier = Modifier.height(16.dp)) }
        }
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 1.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            fontSize = 10.sp,
            color = WatchOnSurface.copy(alpha = 0.6f)
        )
        Text(
            text = value,
            fontSize = 10.sp,
            color = WatchOnSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

private fun batteryLabel(batteryLevel: Int): String = when {
    batteryLevel == 101 -> "⚡ charging"
    batteryLevel <= 0 -> "? bat"
    else -> "$batteryLevel%"
}
