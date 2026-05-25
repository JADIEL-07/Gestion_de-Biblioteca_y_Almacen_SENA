import psycopg2

# Credenciales
connection_string = "postgresql://Jadiel_Zz:12872Jadiel#@db:5432/biblioteca_db"
user_id = "1101755660"

try:
    # Conectar a PostgreSQL
    conn = psycopg2.connect(connection_string)
    cursor = conn.cursor()
    
    # Ejecutar UPDATE
    cursor.execute("""
        UPDATE users 
        SET role_id = (SELECT id FROM roles WHERE name = 'ADMIN')
        WHERE id = %s
    """, (user_id,))
    
    rows_updated = cursor.rowcount
    
    # Verificar el resultado
    cursor.execute("""
        SELECT id, name, email, role_id 
        FROM users 
        WHERE id = %s
    """, (user_id,))
    
    user = cursor.fetchone()
    
    # Commit
    conn.commit()
    
    if rows_updated > 0:
        print(f"✓ Usuario actualizado exitosamente")
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
