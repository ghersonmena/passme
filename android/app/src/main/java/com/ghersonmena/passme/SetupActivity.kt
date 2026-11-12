package com.ghersonmena.passme

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView

// Primera vez (o "Cambiar servidor"): la dirección de tu PassMe. Se comprueba antes de guardarla.
class SetupActivity : Activity() {
    private lateinit var field: EditText
    private lateinit var error: TextView
    private lateinit var connect: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        Edge.apply(this, findViewById(R.id.root))
        field = findViewById(R.id.server)
        error = findViewById(R.id.error)
        connect = findViewById(R.id.connect)
        field.setText(intent.getStringExtra(EXTRA_CURRENT) ?: Server.get(this) ?: BuildConfig.DEFAULT_SERVER)
        connect.setOnClickListener { check() }
        field.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) check()
            action == EditorInfo.IME_ACTION_GO
        }
    }

    private fun check() {
        val origin = Server.normalize(field.text.toString())
        if (origin == null) {
            showError(R.string.setup_invalid)
            return
        }
        error.visibility = View.GONE
        connect.isEnabled = false
        connect.setText(R.string.setup_checking)
        Thread {
            val ok = Server.isPassMe(origin)
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                connect.isEnabled = true
                connect.setText(R.string.setup_connect)
                if (!ok) {
                    showError(R.string.setup_unreachable)
                    return@runOnUiThread
                }
                Server.set(this, origin)
                startActivity(
                    Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                )
                finish()
            }
        }.start()
    }

    private fun showError(text: Int) {
        error.setText(text)
        error.visibility = View.VISIBLE
    }

    companion object {
        const val EXTRA_CURRENT = "current"
    }
}
