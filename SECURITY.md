# Seguridad

## Reportar una vulnerabilidad

Si encuentras un problema de seguridad, **no abras un issue público**. Usa la opción
*Report a vulnerability* en la pestaña *Security* del repositorio en GitHub (aviso privado).

Incluye los pasos para reproducirlo y la versión afectada. Respondemos lo antes posible y te
damos crédito en las notas de la versión si lo deseas.

## Alcance

Nos interesan especialmente:

- Cualquier forma de leer datos de una bóveda sin la contraseña maestra o la frase de recuperación.
- Saltarse el 2FA, el bloqueo por intentos o el aislamiento entre usuarios.
- XSS, CSRF o inyección en la app o la API.

El diseño criptográfico y sus límites conocidos están en [docs/CRYPTO.md](docs/CRYPTO.md).
