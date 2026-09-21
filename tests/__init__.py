import os

# Base de datos de las pruebas: SQLite en memoria por omisión; con TEST_DATABASE_URL se
# corren contra PostgreSQL (misma versión que producción). Las pruebas hacen
# drop_all()/create_all(), así que la base DEBE ser exclusiva y su nombre terminar en
# "_test": si no, se niegan a correr para no borrar datos reales.
TEST_DB_URL = os.environ.get("TEST_DATABASE_URL", "sqlite:///:memory:")
if not TEST_DB_URL.startswith("sqlite"):
    _name = TEST_DB_URL.rsplit("/", 1)[-1].split("?")[0]
    if not _name.endswith("_test"):
        raise RuntimeError(
            f"TEST_DATABASE_URL apunta a la base '{_name}'. Por seguridad solo se aceptan "
            "bases cuyo nombre termina en '_test' (las pruebas borran todas las tablas)."
        )
os.environ["DATABASE_URL"] = TEST_DB_URL

# Los límites de intentos (login, registro, ...) se apagan en las pruebas normales para que
# no se interfieran entre sí; las pruebas de seguridad los encienden a propósito.
os.environ.setdefault("RATELIMIT_ENABLED", "false")
