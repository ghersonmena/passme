package com.ghersonmena.passme

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.InlinePresentation
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.widget.RemoteViews
import androidx.annotation.RequiresApi
import androidx.autofill.inline.UiVersions
import androidx.autofill.inline.v1.InlineSuggestionUi
import java.util.concurrent.atomic.AtomicInteger

// El servicio de autocompletar de Android. Nunca ve las contraseñas: solo ofrece "Desbloquear
// PassMe" y, al tocarlo, abre la web (AutofillActivity), que descifra y elige el login.
class PassMeAutofillService : AutofillService() {
    private val requestCodes = AtomicInteger((System.currentTimeMillis() % 100_000).toInt())

    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val form = FormParser.parse(request.fillContexts.last().structure)
        val ids = listOfNotNull(form.usernameId, form.passwordId)
        // Nada que llenar, la propia app de PassMe, o todavía sin servidor configurado
        if (ids.isEmpty() || form.packageName == packageName || Server.get(this) == null) {
            callback.onSuccess(null)
            return
        }

        val intent = Intent(this, AutofillActivity::class.java)
            .putExtra(AutofillActivity.EXTRA_MODE, "fill")
            .putExtra(AutofillActivity.EXTRA_APP, form.packageName)
            .putExtra(AutofillActivity.EXTRA_DOMAIN, form.webDomain)
            .putExtra(AutofillActivity.EXTRA_USERNAME_ID, form.usernameId)
            .putExtra(AutofillActivity.EXTRA_PASSWORD_ID, form.passwordId)
        // Mutable: Android le agrega a este intent la estructura de la pantalla
        val sender = PendingIntent.getActivity(
            this, requestCodes.incrementAndGet(), intent,
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_MUTABLE
        ).intentSender

        val presentation = RemoteViews(packageName, R.layout.autofill_item).apply {
            setTextViewText(R.id.text, getString(R.string.autofill_unlock))
        }
        val inline = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) inlinePresentation(request) else null
        @Suppress("DEPRECATION")
        val dataset = Dataset.Builder(presentation)
        for (id in ids) {
            if (inline != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                @Suppress("DEPRECATION")
                dataset.setValue(id, null, presentation, inline)
            } else {
                @Suppress("DEPRECATION")
                dataset.setValue(id, null)
            }
        }
        @Suppress("DEPRECATION")
        dataset.setAuthentication(sender)

        val response = FillResponse.Builder().addDataset(dataset.build())
        // Al terminar de iniciar sesión, Android ofrece guardar lo escrito en PassMe
        form.passwordId?.let { password ->
            val type = SaveInfo.SAVE_DATA_TYPE_PASSWORD or
                (if (form.usernameId != null) SaveInfo.SAVE_DATA_TYPE_USERNAME else 0)
            val save = SaveInfo.Builder(type, arrayOf(password))
                .setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)
            form.usernameId?.let { save.setOptionalIds(arrayOf(it)) }
            response.setSaveInfo(save.build())
        }
        callback.onSuccess(response.build())
    }

    // La sugerencia dentro del teclado (Gboard y otros), en Android 11 o más nuevo. getSlice es
    // la forma documentada de usar InlineSuggestionUi aunque lint la marque como interna.
    @SuppressLint("RestrictedApi")
    @RequiresApi(Build.VERSION_CODES.R)
    private fun inlinePresentation(request: FillRequest): InlinePresentation? {
        val inline = request.inlineSuggestionsRequest ?: return null
        if (inline.maxSuggestionCount < 1) return null
        val spec = inline.inlinePresentationSpecs.firstOrNull() ?: return null
        if (UiVersions.INLINE_UI_VERSION_1 !in UiVersions.getVersions(spec.style)) return null
        val attribution = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE
        )
        val content = InlineSuggestionUi.newContentBuilder(attribution)
            .setTitle(getString(R.string.app_name))
            .setSubtitle(getString(R.string.autofill_inline))
            .setStartIcon(Icon.createWithResource(this, R.drawable.ic_key))
            .build()
        return InlinePresentation(content.slice, spec, false)
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        // En los inicios de sesión de dos pasos el usuario y la contraseña van en pantallas distintas
        var username = ""
        var password = ""
        var app = ""
        var domain = ""
        for (context in request.fillContexts) {
            val form = FormParser.parse(context.structure)
            if (form.username.isNotEmpty()) username = form.username
            if (form.password.isNotEmpty()) password = form.password
            if (form.webDomain.isNotEmpty()) domain = form.webDomain
            app = form.packageName
        }
        if (password.isEmpty() || app == packageName) {
            callback.onSuccess()
            return
        }
        val intent = Intent(this, AutofillActivity::class.java)
            .putExtra(AutofillActivity.EXTRA_MODE, "save")
            .putExtra(AutofillActivity.EXTRA_APP, app)
            .putExtra(AutofillActivity.EXTRA_DOMAIN, domain)
            .putExtra(AutofillActivity.EXTRA_USERNAME, username)
            .putExtra(AutofillActivity.EXTRA_PASSWORD, password)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val sender = PendingIntent.getActivity(
                this, requestCodes.incrementAndGet(), intent,
                PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE
            ).intentSender
            callback.onSuccess(sender)
        } else {
            startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            callback.onSuccess()
        }
    }
}
