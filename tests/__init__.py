import os

# Los límites de intentos (login, registro, ...) se apagan en las pruebas normales para que
# no se interfieran entre sí; las pruebas de seguridad los encienden a propósito.
os.environ.setdefault("RATELIMIT_ENABLED", "false")
