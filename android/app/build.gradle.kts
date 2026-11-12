import java.util.Properties

plugins {
    id("com.android.application")
}

// La app lleva el mismo número de versión que la web (package.json de la raíz)
val appVersion: String = Regex("\"version\":\\s*\"([^\"]+)\"")
    .find(rootProject.file("../package.json").readText())!!
    .groupValues[1]
val versionParts = appVersion.split(".").map { it.toInt() }

// Firma de la versión final: android/keystore.properties (fuera de git) apunta a la llave
val signing = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.ghersonmena.passme"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ghersonmena.passme"
        minSdk = 26
        targetSdk = 36
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
        versionName = appVersion
        // Servidor que se propone la primera vez; se puede cambiar en la app
        buildConfigField("String", "DEFAULT_SERVER", "\"https://pass.passme.dpdns.org\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (signing.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release")
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.autofill:autofill:1.3.0")
}
