package com.ghersonmena.passme

import android.app.assist.AssistStructure
import android.app.assist.AssistStructure.ViewNode
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId

// Lo que se encontró en la pantalla de la otra app: dónde va el usuario, dónde la contraseña y
// (al guardar) lo que se escribió
class Form {
    var packageName = ""
    var webDomain = ""
    var usernameId: AutofillId? = null
    var passwordId: AutofillId? = null
    var username = ""
    var password = ""
}

object FormParser {
    private enum class Kind { USERNAME, PASSWORD, TEXT, NONE }

    private val USER_WORDS = listOf("user", "email", "e-mail", "mail", "login", "correo", "usuario", "account", "cuenta", "phone", "tel")
    private val PASSWORD_WORDS = listOf("password", "passwd", "contraseña", "contrasena", "clave", "pin")
    private val SKIP_TYPES = setOf("hidden", "submit", "button", "checkbox", "radio", "search", "file", "image", "reset", "range", "color", "date")

    fun parse(structure: AssistStructure): Form {
        val form = Form()
        form.packageName = structure.activityComponent?.packageName ?: ""
        // Si no hay un campo de usuario claro, se usa el último campo de texto antes de la contraseña
        var lastText: ViewNode? = null

        fun visit(node: ViewNode) {
            node.webDomain?.takeIf { it.isNotEmpty() && form.webDomain.isEmpty() }?.let { form.webDomain = it }
            val id = node.autofillId
            if (id != null && node.autofillType == View.AUTOFILL_TYPE_TEXT) {
                when (classify(node)) {
                    Kind.PASSWORD -> if (form.passwordId == null) {
                        form.passwordId = id
                        form.password = valueOf(node)
                        if (form.usernameId == null) lastText?.let {
                            form.usernameId = it.autofillId
                            form.username = valueOf(it)
                        }
                    }
                    Kind.USERNAME -> if (form.usernameId == null && form.passwordId == null) {
                        form.usernameId = id
                        form.username = valueOf(node)
                    }
                    Kind.TEXT -> if (form.passwordId == null) lastText = node
                    Kind.NONE -> {}
                }
            }
            for (i in 0 until node.childCount) visit(node.getChildAt(i))
        }

        for (i in 0 until structure.windowNodeCount) visit(structure.getWindowNodeAt(i).rootViewNode)
        return form
    }

    private fun valueOf(node: ViewNode): String =
        node.autofillValue?.takeIf { it.isText }?.textValue?.toString() ?: ""

    private fun classify(node: ViewNode): Kind {
        val hints = node.autofillHints?.map { it.lowercase() } ?: emptyList()
        if (hints.any { "password" in it }) return Kind.PASSWORD
        if (hints.any { "username" in it || "email" in it || it == "phone" || it == "phonenumber" }) return Kind.USERNAME

        // Páginas web (Chrome, Firefox…): se leen los atributos del <input>
        node.htmlInfo?.let { html ->
            if (html.tag?.lowercase() != "input") return Kind.NONE
            val attrs = html.attributes?.associate { (it.first ?: "").lowercase() to (it.second ?: "").lowercase() } ?: emptyMap()
            val type = attrs["type"] ?: "text"
            if (type == "password") return Kind.PASSWORD
            if (type in SKIP_TYPES) return Kind.NONE
            if (type == "email") return Kind.USERNAME
            val words = listOf("name", "id", "autocomplete", "placeholder", "aria-label").joinToString(" ") { attrs[it] ?: "" }
            if (USER_WORDS.any { it in words }) return Kind.USERNAME
            return Kind.TEXT
        }

        if (!node.isEnabled || node.visibility != View.VISIBLE) return Kind.NONE
        val cls = node.inputType and InputType.TYPE_MASK_CLASS
        val variation = node.inputType and InputType.TYPE_MASK_VARIATION
        if (cls == InputType.TYPE_CLASS_TEXT && variation in setOf(
                InputType.TYPE_TEXT_VARIATION_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
                InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
            )
        ) return Kind.PASSWORD
        if (cls == InputType.TYPE_CLASS_NUMBER && variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD) return Kind.PASSWORD
        if (cls == InputType.TYPE_CLASS_TEXT && variation in setOf(
                InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
                InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
            )
        ) return Kind.USERNAME

        val words = listOfNotNull(node.idEntry, node.hint).joinToString(" ").lowercase()
        if (PASSWORD_WORDS.any { it in words }) return Kind.PASSWORD
        if (USER_WORDS.any { it in words }) return Kind.USERNAME
        return if (cls == InputType.TYPE_CLASS_TEXT || cls == InputType.TYPE_CLASS_PHONE) Kind.TEXT else Kind.NONE
    }
}
