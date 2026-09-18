"""
Crea los 6 usuarios de prueba ejecutando SQL via 'docker exec psql'
en el container Postgres de Coolify (que no esta expuesto al host).

Genera hashes bcrypt localmente, construye el SQL y lo ejecuta por SSH.
"""
import sys
import os
import shlex
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from dotenv import load_dotenv
load_dotenv()

import bcrypt
import paramiko

ssh_host = os.environ.get('SSH_HOST')
ssh_user = os.environ.get('SSH_USER')
ssh_password = os.environ.get('SSH_PASSWORD')

# Nada de esto va escrito en el código: se lee del entorno (.env, que no se sube a git).
PG_USER = os.environ.get('POSTGRES_USER')
PG_PASSWORD = os.environ.get('POSTGRES_PASSWORD')
PG_DB = os.environ.get('POSTGRES_DB', 'biblioteca_db')
CONTAINER_NAME = os.environ.get('DB_CONTAINER_NAME')
if not (PG_USER and PG_PASSWORD and CONTAINER_NAME):
    sys.exit("Faltan POSTGRES_USER, POSTGRES_PASSWORD y DB_CONTAINER_NAME en el entorno.")

# Contraseña de las cuentas de prueba: la que definas en TEST_USERS_PASSWORD o, si no,
# una aleatoria que se imprime al final (antes era una fija y conocida).
import secrets
PASSWORD = os.environ.get('TEST_USERS_PASSWORD') or secrets.token_urlsafe(12)

USERS = [
    ("1101755660", "Admin Test",         "admin.test@sena.edu.co",         "ADMIN"),
    ("1101755661", "Soporte Test",       "soporte.test@sena.edu.co",       "SOPORTE_TECNICO"),
    ("1101755662", "Aprendiz Test",      "aprendiz.test@sena.edu.co",      "APRENDIZ"),
    ("1101755663", "Bibliotecario Test", "bibliotecario.test@sena.edu.co", "BIBLIOTECARIO"),
    ("1101755664", "Almacenista Test",   "almacenista.test@sena.edu.co",   "ALMACENISTA"),
    ("1101755665", "Usuario Test",       "usuario.test@sena.edu.co",       "USUARIO"),
]

print("Generando hashes bcrypt...")
hashed_pw = bcrypt.hashpw(PASSWORD.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
print(f"Hash listo (len={len(hashed_pw)}).\n")


def sql_escape(s):
    return s.replace("'", "''")


# Construir SQL: primero asegurar que las tablas de chat existan, luego upsert usuarios
sql_parts = [
    # Tablas de chat (idempotente)
    """
    CREATE TABLE IF NOT EXISTS ticket_messages (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES tickets(id),
        sender_id VARCHAR(50) NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_ticket_messages_ticket_id ON ticket_messages(ticket_id);",
    """
    CREATE TABLE IF NOT EXISTS staff_messages (
        id SERIAL PRIMARY KEY,
        sender_id VARCHAR(50) NOT NULL REFERENCES users(id),
        receiver_id VARCHAR(50) NOT NULL REFERENCES users(id),
        body TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """,
    "CREATE INDEX IF NOT EXISTS ix_staff_messages_sender_id ON staff_messages(sender_id);",
    "CREATE INDEX IF NOT EXISTS ix_staff_messages_receiver_id ON staff_messages(receiver_id);",
]

# Asegurar que los 7 roles base existan
for role_name in ['ADMIN', 'BIBLIOTECARIO', 'ALMACENISTA', 'SOPORTE_TECNICO', 'EMPRESA', 'APRENDIZ', 'USUARIO']:
    sql_parts.append(
        f"INSERT INTO roles (name, created_at, updated_at) VALUES ('{role_name}', NOW(), NOW()) "
        f"ON CONFLICT (name) DO NOTHING;"
    )

# Upsert usuarios
for uid, name, email, role_name in USERS:
    sql_parts.append(f"""
    INSERT INTO users (
        id, document_type, name, email, password, role_id,
        is_active, is_blocked, is_deleted, failed_attempts, created_at, updated_at
    )
    VALUES (
        '{uid}',
        'Cedula de Ciudadania',
        '{sql_escape(name)}',
        '{sql_escape(email)}',
        '{hashed_pw}',
        (SELECT id FROM roles WHERE name = '{role_name}' LIMIT 1),
        TRUE, FALSE, FALSE, 0, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        role_id = EXCLUDED.role_id,
        is_active = TRUE,
        is_blocked = FALSE,
        is_deleted = FALSE,
        failed_attempts = 0,
        updated_at = NOW();
    """)

# Verificacion al final
sql_parts.append("""
SELECT u.id, u.name, u.email, r.name AS role, u.is_active, u.is_blocked
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE u.id IN ('1101755660','1101755661','1101755662','1101755663','1101755664','1101755665')
ORDER BY u.id;
""")

full_sql = "\n".join(sql_parts)

print(f"Conectando SSH a {ssh_user}@{ssh_host}...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(ssh_host, username=ssh_user, password=ssh_password, allow_agent=False, look_for_keys=False)
print("Conectado.\n")

# Pasar el SQL via stdin al psql dentro del container
cmd = (
    f"docker exec -i -e PGPASSWORD={shlex.quote(PG_PASSWORD)} "
    f"{CONTAINER_NAME} "
    f"psql -U {PG_USER} -d {PG_DB} -v ON_ERROR_STOP=1"
)

print(f"Ejecutando psql via docker exec en {CONTAINER_NAME}...")
print("-" * 70)
stdin, stdout, stderr = client.exec_command(cmd)
stdin.write(full_sql)
stdin.channel.shutdown_write()

out = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

print(out)
if err:
    print("STDERR:", err)

exit_code = stdout.channel.recv_exit_status()
print("-" * 70)
if exit_code == 0:
    print(f"\n[OK] Usuarios creados/actualizados. Password: {PASSWORD}")
else:
    print(f"\n[ERROR] psql termino con codigo {exit_code}")

client.close()
