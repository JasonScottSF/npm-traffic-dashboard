package com.example.meshtasticwatch.wear.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Shapes
import androidx.wear.compose.material.Typography

// Meshtastic brand color — green
val MeshtasticGreen = Color(0xFF00C853)
val MeshtasticGreenDark = Color(0xFF009624)
val MeshtasticGreenLight = Color(0xFF5EFC82)

// Background — OLED-friendly black / very dark gray
val WatchBackground = Color(0xFF000000)
val WatchSurface = Color(0xFF1A1A1A)
val WatchOnSurface = Color(0xFFE0E0E0)
val WatchOnBackground = Color(0xFFFFFFFF)

// Status colors
val WatchWarning = Color(0xFFFFAB00)
val WatchError = Color(0xFFFF5252)
val WatchSuccess = MeshtasticGreen

private val MeshtasticColors = Colors(
    primary = MeshtasticGreen,
    primaryVariant = MeshtasticGreenDark,
    secondary = MeshtasticGreenLight,
    secondaryVariant = MeshtasticGreenDark,
    background = WatchBackground,
    surface = WatchSurface,
    error = WatchError,
    onPrimary = WatchBackground,
    onSecondary = WatchBackground,
    onBackground = WatchOnBackground,
    onSurface = WatchOnSurface,
    onError = WatchBackground
)

/**
 * Meshtastic Wear OS theme.
 *
 * Uses a black OLED background with Meshtastic brand green (#00C853) as the
 * primary accent color. Typography and shapes use Wear OS defaults.
 */
@Composable
fun MeshtasticWatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = MeshtasticColors,
        typography = Typography(),
        shapes = Shapes(),
        content = content
    )
}
