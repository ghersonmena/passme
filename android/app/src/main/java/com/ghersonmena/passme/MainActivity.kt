package com.ghersonmena.passme

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.view.autofill.AutofillManager
import org.json.JSONObject

// La app: la web de PassMe a pantalla completa
class MainActivity : WebActivity() {
    override fun startUrl() = "$server/"

    override fun onMessage(type: String, msg: JSONObject, reply: (JSONObject) -> Unit) {
        when (type) {
            "info" -> reply(
                JSONObject()
                    .put("type", "info")
                    .put("server", server)
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("autofill", autofillStatus())
            )
            "changeServer" -> changeServer()
            "autofillSettings" -> openAutofillSettings()
        }
    }

    private fun autofillStatus(): String {
        val manager = getSystemService(AutofillManager::class.java)
        return when {
            manager == null || !manager.isAutofillSupported -> "unsupported"
            manager.hasEnabledAutofillServices() -> "enabled"
            else -> "disabled"
        }
    }

    // Android pregunta si PassMe debe ser el servicio de autocompletar
    private fun openAutofillSettings() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE, Uri.parse("package:$packageName")))
        } catch (_: ActivityNotFoundException) {
            startActivity(Intent(Settings.ACTION_SETTINGS))
        }
    }
}
