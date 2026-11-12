package com.ghersonmena.passme

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.service.autofill.Dataset
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import org.json.JSONObject

// La web de PassMe cuando otra app pide un login (?autofill=fill) o guardar uno (?autofill=save).
// Se desbloquea igual que la app (PIN, patrón o contraseña maestra) y la web contesta con el
// login elegido, que aquí se devuelve a Android para llenar la otra app.
class AutofillActivity : WebActivity() {
    private val mode get() = if (intent.getStringExtra(EXTRA_MODE) == "save") "save" else "fill"
    private val app get() = intent.getStringExtra(EXTRA_APP) ?: ""
    private val domain get() = intent.getStringExtra(EXTRA_DOMAIN) ?: ""

    override fun startUrl() = "$server/?autofill=$mode"

    override fun onMessage(type: String, msg: JSONObject, reply: (JSONObject) -> Unit) {
        when (type) {
            "context" -> reply(
                JSONObject()
                    .put("type", "context")
                    .put("app", app)
                    .put("appLabel", appLabel(app))
                    .put("domain", domain)
                    .apply {
                        if (mode == "save") {
                            put("username", intent.getStringExtra(EXTRA_USERNAME) ?: "")
                            put("password", intent.getStringExtra(EXTRA_PASSWORD) ?: "")
                        }
                    }
            )
            "fill" -> if (mode == "fill") fill(msg.optString("username"), msg.optString("password"))
            "saved", "cancel" -> finish()
        }
    }

    private fun appLabel(pkg: String): String = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (_: PackageManager.NameNotFoundException) {
        ""
    }

    private fun autofillId(key: String): AutofillId? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(key, AutofillId::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(key)
        }

    private fun fill(username: String, password: String) {
        val presentation = RemoteViews(packageName, R.layout.autofill_item).apply {
            setTextViewText(R.id.text, username.ifEmpty { getString(R.string.app_name) })
        }
        @Suppress("DEPRECATION")
        val dataset = Dataset.Builder(presentation)
        var any = false
        autofillId(EXTRA_USERNAME_ID)?.takeIf { username.isNotEmpty() }?.let {
            @Suppress("DEPRECATION")
            dataset.setValue(it, AutofillValue.forText(username))
            any = true
        }
        autofillId(EXTRA_PASSWORD_ID)?.takeIf { password.isNotEmpty() }?.let {
            @Suppress("DEPRECATION")
            dataset.setValue(it, AutofillValue.forText(password))
            any = true
        }
        if (any) setResult(RESULT_OK, Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset.build()))
        finish()
    }

    companion object {
        const val EXTRA_MODE = "mode"
        const val EXTRA_APP = "app"
        const val EXTRA_DOMAIN = "domain"
        const val EXTRA_USERNAME_ID = "usernameId"
        const val EXTRA_PASSWORD_ID = "passwordId"
        const val EXTRA_USERNAME = "username"
        const val EXTRA_PASSWORD = "password"
    }
}
