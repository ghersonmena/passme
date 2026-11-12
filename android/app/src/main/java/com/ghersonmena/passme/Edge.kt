package com.ghersonmena.passme

import android.app.Activity
import android.os.Build
import android.view.View
import android.view.WindowInsets

// Desde Android 15 las apps se dibujan detrás de las barras del sistema: el contenido se aparta
// de ellas (y del teclado) con relleno. Antes de Android 11 el sistema ya lo hace solo.
object Edge {
    fun apply(activity: Activity, root: View) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        // En Android 15 ya viene así; en 11 a 14 hay que pedirlo
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            @Suppress("DEPRECATION")
            activity.window.setDecorFitsSystemWindows(false)
        }
        root.setOnApplyWindowInsetsListener { view, insets ->
            val bars = insets.getInsets(
                WindowInsets.Type.systemBars() or WindowInsets.Type.ime() or WindowInsets.Type.displayCutout()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsets.CONSUMED
        }
    }
}
