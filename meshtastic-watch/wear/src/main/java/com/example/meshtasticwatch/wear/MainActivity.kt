package com.example.meshtasticwatch.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.rememberScalingLazyListState
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.example.meshtasticwatch.wear.ui.screens.GpsScreen
import com.example.meshtasticwatch.wear.ui.screens.MessagesScreen
import com.example.meshtasticwatch.wear.ui.screens.MetricsScreen
import com.example.meshtasticwatch.wear.ui.screens.NodesScreen
import com.example.meshtasticwatch.wear.ui.theme.MeshtasticGreen
import com.example.meshtasticwatch.wear.ui.theme.MeshtasticWatchTheme
import com.example.meshtasticwatch.wear.ui.theme.WatchOnSurface
import com.example.meshtasticwatch.wear.viewmodel.MeshViewModel

/**
 * Main entry point for the Meshtastic Wear OS companion app.
 *
 * Navigation structure (SwipeDismissableNavHost):
 *   home     — menu with 4 items: Messages, Nodes, GPS, Metrics
 *   messages — [MessagesScreen]
 *   nodes    — [NodesScreen]
 *   gps      — [GpsScreen]
 *   metrics  — [MetricsScreen]
 *
 * The home screen shows live counts/summaries for each section via badges.
 * Swipe-to-dismiss on sub-screens returns to the home menu.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MeshtasticWatchTheme {
                WearApp()
            }
        }
    }
}

@Composable
fun WearApp() {
    val navController = rememberSwipeDismissableNavController()
    val viewModel: MeshViewModel = viewModel()

    SwipeDismissableNavHost(
        navController = navController,
        startDestination = "home"
    ) {
        composable("home") {
            HomeScreen(navController = navController, viewModel = viewModel)
        }
        composable("messages") {
            MessagesScreen(viewModel = viewModel)
        }
        composable("nodes") {
            NodesScreen(viewModel = viewModel)
        }
        composable("gps") {
            GpsScreen(viewModel = viewModel)
        }
        composable("metrics") {
            MetricsScreen(viewModel = viewModel)
        }
    }
}

@Composable
fun HomeScreen(navController: NavHostController, viewModel: MeshViewModel) {
    val messages by viewModel.messages.collectAsState()
    val nodes by viewModel.nodes.collectAsState()
    val position by viewModel.position.collectAsState()
    val metrics by viewModel.metrics.collectAsState()
    val isPhoneConnected by viewModel.isPhoneConnected.collectAsState()

    val listState = rememberScalingLazyListState()

    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = listState,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "Meshtastic",
                    style = MaterialTheme.typography.title2,
                    color = MeshtasticGreen,
                    modifier = Modifier.padding(top = 8.dp)
                )
                Text(
                    text = if (isPhoneConnected) "Phone connected" else "Phone disconnected",
                    fontSize = 9.sp,
                    color = if (isPhoneConnected) MeshtasticGreen.copy(alpha = 0.7f)
                    else WatchOnSurface.copy(alpha = 0.4f),
                    modifier = Modifier.padding(bottom = 4.dp)
                )
            }
        }

        // Messages
        item {
            HomeMenuItem(
                title = "Messages",
                badge = if (messages.isEmpty()) "none"
                        else "${messages.size} msg${if (messages.size != 1) "s" else ""}",
                subtitle = messages.lastOrNull()?.let { "From ${it.from}" } ?: "No messages",
                onClick = { navController.navigate("messages") }
            )
        }

        // Nodes
        item {
            HomeMenuItem(
                title = "Nodes",
                badge = if (nodes.isEmpty()) "none" else "${nodes.size} node${if (nodes.size != 1) "s" else ""}",
                subtitle = if (nodes.isEmpty()) "No nodes seen"
                           else nodes.maxByOrNull { it.lastHeardSec }?.let {
                               "Last: ${it.shortName}"
                           } ?: "—",
                onClick = { navController.navigate("nodes") }
            )
        }

        // GPS
        item {
            HomeMenuItem(
                title = "GPS",
                badge = if (position != null) "fix" else "no fix",
                subtitle = position?.let {
                    "${"%.4f".format(it.latitude)}, ${"%.4f".format(it.longitude)}"
                } ?: "Waiting for position",
                onClick = { navController.navigate("gps") }
            )
        }

        // Metrics
        item {
            HomeMenuItem(
                title = "Metrics",
                badge = metrics?.let {
                    if (it.batteryLevel == 101) "⚡" else "${it.batteryLevel}%"
                } ?: "—",
                subtitle = metrics?.let {
                    "ChUtil ${"%.1f".format(it.channelUtilization)}%"
                } ?: "No data",
                onClick = { navController.navigate("metrics") }
            )
        }

        item { Spacer(modifier = Modifier.height(16.dp)) }
    }
}

@Composable
private fun HomeMenuItem(
    title: String,
    badge: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 4.dp, vertical = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    color = MaterialTheme.colors.onSurface
                )
                Text(
                    text = subtitle,
                    fontSize = 10.sp,
                    color = WatchOnSurface.copy(alpha = 0.6f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Text(
                text = badge,
                fontSize = 11.sp,
                color = MeshtasticGreen,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(start = 6.dp)
            )
        }
    }
}
