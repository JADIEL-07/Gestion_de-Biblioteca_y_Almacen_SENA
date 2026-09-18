"""Promueve un usuario a ADMIN directamente en PostgreSQL.

Uso:
    DATABASE_URL=postgresql://usuario:clave@host:5432/base python scripts/admin/promote_to_admin_direct.py 1101755660

La conexión se lee de DATABASE_URL (nunca se escribe en el código) y el documento
del usuario se pasa como argumento.
"""
import os
import sys

import psycopg2

connection_string = os.environ.get("DATABASE_URL")
if not connection_string or not connection_string.startswith("postgres"):
    sys.exit("Define DATABASE_URL con la conexión a PostgreSQL (postgresql://usuario:clave@host:5432/base).")
if len(sys.argv) != 2:
    sys.exit("Uso: python scripts/admin/promote_to_admin_direct.py <documento_del_usuario>")
user_id = sys.argv[1].strip()

try:
    conn = psycopg2.connect(connection_string)
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE users
        SET role_id = (SELECT id FROM roles WHERE name = 'ADMIN')
        WHERE id = %s
    """, (user_id,))
    rows_updated = cursor.rowcount

    cursor.execute("""
        SELECT id, name, email, role_id
        FROM users
        WHERE id = %s
    """, (user_id,))
    user = cursor.fetchone()

    conn.commit()

    if rows_updated > 0:
        print("✓ Usuario actualizado exitosamente")
        print(f"  ID: {user[0]}")
        print(f"  Nombre: {user[1]}")
        print(f"  Email: {user[2]}")
        print(f"  Role ID: {user[3]}")
    else:
        print(f"✗ No se encontró usuario con ID: {user_id}")

    cursor.close()
    conn.close()

except Exception as e:
    print(f"✗ Error: {e}")
