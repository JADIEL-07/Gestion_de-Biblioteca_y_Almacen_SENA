#!/usr/bin/env python
"""Script para crear 10 libros en la base de datos."""
import sys
sys.path.insert(0, '.')

from app import create_app, db
from app.models.item import Item, Category, Location, Status

app = create_app()

with app.app_context():
    # Crear categoría "Libros"
    category = Category.query.filter_by(name='Libros').first()
    if not category:
        category = Category(name='Libros')
        db.session.add(category)
        db.session.commit()
        print(f"[OK] Categoría 'Libros' creada con ID: {category.id}")
    else:
        print(f"[OK] Categoría 'Libros' encontrada con ID: {category.id}")
    
    # Obtener ubicación "Pasillo A"
    location = Location.query.filter_by(name='Pasillo A').first()
    if not location:
        print("[ERROR] Ubicación 'Pasillo A' no existe")
        print(f"[INFO] Ubicaciones disponibles: {[l.name for l in Location.query.all()]}")
        sys.exit(1)
    else:
        print(f"[OK] Ubicación 'Pasillo A' encontrada con ID: {location.id}")
    
    # Obtener estado AVAILABLE
    status = Status.query.filter_by(name='AVAILABLE').first()
    if not status:
        print("[ERROR] Estado 'AVAILABLE' no existe")
        print(f"[INFO] Estados disponibles: {[s.name for s in Status.query.all()]}")
        sys.exit(1)
    else:
        print(f"[OK] Estado 'AVAILABLE' encontrado con ID: {status.id}")

    # Datos de 10 libros
    books_data = [
        {"name": "El Quijote", "brand": "Miguel de Cervantes", "serial": "9788408221258"},
        {"name": "Cien años de soledad", "brand": "Gabriel García Márquez", "serial": "9788420411842"},
        {"name": "La casa de los espíritus", "brand": "Isabel Allende", "serial": "9788401433974"},
        {"name": "Pedro Páramo", "brand": "Juan Rulfo", "serial": "9788420411834"},
        {"name": "Rayuela", "brand": "Julio Cortázar", "serial": "9788432201677"},
        {"name": "La Metamorfosis", "brand": "Franz Kafka", "serial": "9788441430716"},
        {"name": "Crimen y castigo", "brand": "Fiódor Dostoyevski", "serial": "9788490018782"},
        {"name": "Mujercitas", "brand": "Louisa May Alcott", "serial": "9788408223352"},
        {"name": "El príncipe", "brand": "Nicolás Maquiavelo", "serial": "9788440219848"},
        {"name": "Orgullo y prejuicio", "brand": "Jane Austen", "serial": "9788408103059"}
    ]

    created = 0
    for idx, book in enumerate(books_data, 1):
        code = f"ISBN-{idx:03d}-{book['serial'][-5:]}"
        existing = Item.query.filter_by(code=code).first()
        if existing:
            print(f"[SKIP] Libro {idx}: '{book['name']}' ya existe")
            continue

        item = Item(
            name=book['name'],
            description=f"Obra clásica de {book['brand']}",
            code=code,
            category_id=category.id,
            location_id=location.id,
            status_id=status.id,
            brand=book['brand'],
            serial_number=book['serial'],
            stock=2,
            physical_condition='EXCELENTE'
        )
        db.session.add(item)
        created += 1
        print(f"[OK] Libro {idx}: '{book['name']}' agregado")

    db.session.commit()
    print(f"\n[SUCCESS] {created} de 10 libros creados exitosamente en 'Pasillo A'")
