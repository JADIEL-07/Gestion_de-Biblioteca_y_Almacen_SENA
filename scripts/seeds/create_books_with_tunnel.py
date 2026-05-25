#!/usr/bin/env python
"""
Script para crear 10 libros en la BD remota a través del tunel ya existente.
Este script se conecta al tunel del servidor en puerto 61636.
"""
import os
import sys
import bcrypt
from dotenv import load_dotenv

# Cargar variables de entorno
load_dotenv()

# El servidor ya tiene el túnel en puerto 61636, así que nos conectamos a través de él
print("[INFO] Conectando a BD remota a través del túnel existente (puerto 61636)...")

# Importar y configurar Flask aquí
sys.path.insert(0, '.')

# Parchear DATABASE_URL para usar el túnel del servidor
PG_USER = os.getenv('POSTGRES_USER', 'postgres')
PG_PASSWORD = os.getenv('POSTGRES_PASSWORD', '')
PG_DB = os.getenv('POSTGRES_DB', 'biblioteca_db')

os.environ['DATABASE_URL'] = f"postgresql://{PG_USER}:{PG_PASSWORD}@127.0.0.1:61636/{PG_DB}"

from app import create_app, db
from app.models.item import Item, Category, Status, Location
from app.models.user import User, Role

app = create_app()

with app.app_context():
    print("\n[INFO] Verificando/creando admin user...")
    
    # Asegurar que el rol ADMIN existe
    admin_role = Role.query.filter_by(name='ADMIN').first()
    if not admin_role:
        admin_role = Role(name='ADMIN')
        db.session.add(admin_role)
        db.session.commit()
        print("[OK] Rol ADMIN creado")
    
    # Crear o actualizar usuario admin
    admin_email = "admin@sena.edu.co"
    admin_user = User.query.filter_by(email=admin_email).first()
    
    if not admin_user:
        import uuid
        hashed_pw = bcrypt.hashpw("root1234".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        admin_user = User(
            id=str(uuid.uuid4()),
            name="Admin",
            email=admin_email,
            password=hashed_pw,
            role_id=admin_role.id,
            document_type="Cédula de Ciudadanía",
            is_active=True
        )
        db.session.add(admin_user)
        db.session.commit()
        print(f"[OK] Usuario admin creado")
    else:
        print(f"[OK] Usuario admin ya existe")
    
    # Verificar categoría y ubicación
    category = Category.query.filter_by(name='Libros').first()
    if not category:
        category = Category(name='Libros')
        db.session.add(category)
        db.session.commit()
        print(f"[OK] Categoría 'Libros' creada")
    
    location = Location.query.filter_by(name='Pasillo A').first()
    if not location:
        print("[ERROR] Ubicación 'Pasillo A' no existe")
        sys.exit(1)
    
    status = Status.query.filter_by(name='AVAILABLE').first()
    if not status:
        print("[ERROR] Estado 'AVAILABLE' no existe")
        sys.exit(1)
    
    # Crear 10 libros
    print("\n[INFO] Creando 10 libros...")
    books = [
        ("El Quijote", "Cervantes", "9788408221258"),
        ("Cien años de soledad", "García Márquez", "9788420411842"),
        ("La casa de los espíritus", "Allende", "9788401433974"),
        ("Pedro Páramo", "Rulfo", "9788420411834"),
        ("Rayuela", "Cortázar", "9788432201677"),
        ("La Metamorfosis", "Kafka", "9788441430716"),
        ("Crimen y castigo", "Dostoyevski", "9788490018782"),
        ("Mujercitas", "Alcott", "9788408223352"),
        ("El príncipe", "Maquiavelo", "9788440219848"),
        ("Orgullo y prejuicio", "Austen", "9788408103059")
    ]
    
    created = 0
    for i, (name, brand, serial) in enumerate(books, 1):
        code = f"ISBN-{i:03d}"
        existing = Item.query.filter_by(code=code).first()
        if existing:
            print(f"  [SKIP] {i}. {name} (ya existe)")
            continue
        
        item = Item(
            name=name,
            code=code,
            category_id=category.id,
            location_id=location.id,
            status_id=status.id,
            brand=brand,
            serial_number=serial,
            stock=2,
            physical_condition='EXCELENTE'
        )
        db.session.add(item)
        created += 1
        print(f"  [OK] {i}. {name}")
    
    db.session.commit()
    print(f"\n[SUCCESS] {created} de 10 libros creados exitosamente en 'Pasillo A'!")
