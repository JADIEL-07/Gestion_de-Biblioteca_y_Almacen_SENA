from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from ..extensions import db
from ..models.item import Item, Category, Status, Location
from ..models.movement import Notification
from ..models.user import User, Role
from sqlalchemy import or_, String

items_bp = Blueprint('items', __name__)

def serialize_item(item):
    """Serializa un objeto Item a diccionario de forma segura."""
    return {
        "id": item.id,
        "name": item.name or "",
        "code": item.code or "",
        "category_id": item.category_id,
        "category_name": item.category.name if item.category else "N/A",
        "status_id": item.status_id,
        "status_name": item.status_obj.name if item.status_obj else "N/A",
        "location_id": item.location_id,
        "location_name": item.location.name if item.location else "N/A",
        "brand": item.brand,
        "model": item.model,
        "serial_number": item.serial_number,
        "image_url": item.image_url,
        "stock": item.stock if item.stock is not None else 1,
        "description": item.description or "",
    }

@items_bp.route('/', methods=['GET'])
def get_items():
    search = request.args.get('search', '')
    cat_id = request.args.get('category_id')
    stat_id = request.args.get('status_id')
    loc_id = request.args.get('location_id')

    query = Item.query

    # Búsqueda global
    if search:
        search_filter = f"%{search}%"
        query = query.outerjoin(Category, Item.category_id == Category.id)\
                     .outerjoin(Status, Item.status_id == Status.id)
        query = query.filter(
            or_(
                Item.id.cast(String).ilike(search_filter),
                Item.name.ilike(search_filter),
                Item.code.ilike(search_filter),
                Item.brand.ilike(search_filter),
                Item.model.ilike(search_filter),
                Item.serial_number.ilike(search_filter),
                Category.name.ilike(search_filter),
                Status.name.ilike(search_filter)
            )
        )

    # Filtros específicos
    if cat_id and cat_id not in ['ALL', '', 'undefined', 'null']:
        query = query.filter(Item.category_id == cat_id)
    if stat_id and stat_id not in ['ALL', '', 'undefined', 'null']:
        query = query.filter(Item.status_id == stat_id)
    if loc_id and loc_id not in ['ALL', '', 'undefined', 'null']:
        query = query.filter(Item.location_id == loc_id)
        
    # Filtro de seguridad/separación por Dependencia (Biblioteca vs Almacén)
    dep_id = request.args.get('dependency_id')
    if dep_id and dep_id not in ['ALL', '', 'undefined', 'null']:
        query = query.join(Location, Item.location_id == Location.id).filter(Location.dependency_id == dep_id)

    try:
        items = query.order_by(Item.id.desc()).all()
        return jsonify([serialize_item(i) for i in items])
    except Exception as e:
        print(f"[ERROR] get_items: {e}")
        return jsonify({"error": str(e)}), 500

@items_bp.route('/filters', methods=['GET'])
def get_item_filters():
    dep_id = request.args.get('dependency_id')
    try:
        from ..models.dependency import Dependency
        categories = Category.query.all()
        statuses = Status.query.all()
        dependencies = Dependency.query.all()
        
        loc_query = Location.query
        if dep_id and dep_id not in ['ALL', '', 'undefined', 'null']:
            loc_query = loc_query.filter(Location.dependency_id == dep_id)
        locations = loc_query.all()
        
        return jsonify({
            "categories": [{"id": c.id, "name": c.name} for c in categories],
            "statuses": [{"id": s.id, "name": s.name} for s in statuses],
            "locations": [{"id": l.id, "name": l.name, "dependency_id": l.dependency_id} for l in locations],
            "dependencies": [{"id": d.id, "name": d.name} for d in dependencies]
        })
    except Exception as e:
        print(f"[ERROR] get_item_filters: {e}")
        return jsonify({"categories": [], "statuses": [], "locations": [], "dependencies": []}), 500


@items_bp.route('/<int:id>', methods=['GET'])
def get_item(id):
    item = Item.query.get_or_404(id)
    return jsonify(serialize_item(item))

@items_bp.route('/', methods=['POST'])
@jwt_required()
def add_item():
    data = request.json
    if not data:
        return jsonify({"error": "No se recibieron datos"}), 400

    # Manejo de categoría y ubicación por defecto
    category_id = data.get('category_id')
    if not category_id:
        default_cat = Category.query.filter_by(name='GENERAL').first()
        category_id = default_cat.id if default_cat else 1

    location_id = data.get('location_id')
    if not location_id:
        default_loc = Location.query.filter_by(name='ALMACEN GENERAL').first()
        location_id = default_loc.id if default_loc else 1

    new_item = Item(
        name=data.get('name') or data.get('nombre'),
        description=data.get('description') or data.get('descripcion'),
        code=data.get('code') or data.get('codigo'),
        category_id=category_id,
        location_id=location_id,
        status_id=data.get('status_id'),
        supplier_id=data.get('supplier_id'),
        brand=data.get('brand'),
        model=data.get('model'),
        serial_number=data.get('serial_number') or None,
        image_url=data.get('image_url'),
        stock=data.get('stock', 1)
    )
    try:
        db.session.add(new_item)
        db.session.commit()

        staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
        staff_role_ids = [r.id for r in staff_roles]
        staff_users = User.query.filter(
            User.role_id.in_(staff_role_ids),
            User.is_deleted == False,
            User.is_active == True,
        ).all()
        for su in staff_users:
            db.session.add(Notification(
                user_id=str(su.id),
                type='ITEM_CREATED',
                title='Nuevo elemento agregado',
                message=f'Se agregó "{new_item.name}" al inventario.',
                related_type='item',
                related_id=new_item.id,
            ))
        db.session.commit()

        return jsonify({"id": new_item.id, "name": new_item.name, "message": "Elemento creado exitosamente"}), 201
    except Exception as e:
        db.session.rollback()
        error_msg = str(e)
        print(f"[ERROR] add_item: {error_msg}")
        if "UNIQUE constraint failed" in error_msg:
            if "items.code" in error_msg:
                return jsonify({"error": "El código (QR/Barras) ya está registrado en otro elemento"}), 400
            if "items.serial_number" in error_msg:
                return jsonify({"error": "El número de serie ya está registrado"}), 400
        return jsonify({"error": "Error de validación: Verifique que todos los campos obligatorios estén llenos"}), 400

@items_bp.route('/<int:id>', methods=['PUT'])
@jwt_required()
def update_item(id):
    item = Item.query.get_or_404(id)
    data = request.json
    if not data:
        return jsonify({"error": "No se recibieron datos"}), 400

    # Actualizar solo los campos enviados
    if 'name' in data:       item.name        = data['name']
    if 'code' in data:       item.code        = data['code']
    if 'description' in data: item.description = data['description']
    if 'brand' in data:      item.brand       = data['brand']
    if 'model' in data:      item.model       = data['model']
    if 'serial_number' in data:
        item.serial_number = data['serial_number'] or None
    if 'stock' in data:      item.stock       = int(data['stock'])
    if 'image_url' in data:  item.image_url   = data['image_url']
    if 'category_id' in data and data['category_id']:
        item.category_id = int(data['category_id'])
    if 'status_id' in data and data['status_id']:
        item.status_id   = int(data['status_id'])
    if 'location_id' in data and data['location_id']:
        item.location_id = int(data['location_id'])
    
    # Nuevos campos faltantes
    if 'acquisition_date' in data and data['acquisition_date']:
        from datetime import datetime
        try:
            item.acquisition_date = datetime.strptime(data['acquisition_date'], '%Y-%m-%d')
        except: pass
    if 'value' in data:
        try: item.value = float(data['value'])
        except: item.value = 0
    if 'nit' in data:
        item.nit = data['nit']

    try:
        db.session.commit()
        return jsonify(serialize_item(item)), 200
    except Exception as e:
        db.session.rollback()
        error_msg = str(e)
        print(f"[ERROR] update_item: {error_msg}")
        if "UNIQUE constraint failed" in error_msg:
            if "items.code" in error_msg:
                return jsonify({"error": "El código ya está en uso por otro elemento"}), 400
            if "items.serial_number" in error_msg:
                return jsonify({"error": "El número de serie ya está registrado"}), 400
        return jsonify({"error": "Error al actualizar el elemento"}), 400

@items_bp.route('/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_item(id):
    item = Item.query.get_or_404(id)
    try:
        db.session.delete(item)
        db.session.commit()
        return jsonify({"message": f"Elemento '{item.name}' eliminado exitosamente"}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[ERROR] delete_item: {e}")
        return jsonify({"error": "No se puede eliminar este elemento (puede tener préstamos o reservas asociadas)"}), 400
# --- CATEGORIES CRUD ---
@items_bp.route('/categories', methods=['POST'])
@jwt_required()
def add_category():
    data = request.json
    print(f"[DEBUG] add_category data: {data}")
    if not data or not data.get('name'):
        return jsonify({"error": "Nombre de categoría requerido"}), 400
    try:
        new_cat = Category(name=data['name'])
        db.session.add(new_cat)
        db.session.commit()

        staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
        staff_role_ids = [r.id for r in staff_roles]
        staff_users = User.query.filter(
            User.role_id.in_(staff_role_ids),
            User.is_deleted == False,
            User.is_active == True,
        ).all()
        for su in staff_users:
            db.session.add(Notification(
                user_id=str(su.id),
                type='CATEGORY_CREATED',
                title='Nueva categoría agregada',
                message=f'Se agregó la categoría "{new_cat.name}".',
                related_type='item',
            ))
        db.session.commit()

        return jsonify({"id": new_cat.id, "name": new_cat.name}), 201
    except Exception as e:
        db.session.rollback()
        print(f"[DEBUG ERROR] add_category: {str(e)}")
        return jsonify({"error": f"Error al crear categoría: {str(e)}"}), 400

@items_bp.route('/categories/<int:id>', methods=['PUT'])
@jwt_required()
def update_category(id):
    cat = Category.query.get_or_404(id)
    data = request.json
    if not data or not data.get('name'):
        return jsonify({"error": "Nombre de categoría requerido"}), 400
    try:
        cat.name = data['name']
        db.session.commit()
        return jsonify({"id": cat.id, "name": cat.name}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[DEBUG ERROR] update_category: {str(e)}")
        return jsonify({"error": f"Error al actualizar categoría: {str(e)}"}), 400

@items_bp.route('/categories/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_category(id):
    cat = Category.query.get_or_404(id)
    try:
        db.session.delete(cat)
        db.session.commit()
        return jsonify({"message": "Categoría eliminada"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "No se puede eliminar: tiene elementos asociados"}), 400

# --- LOCATIONS CRUD ---
@items_bp.route('/locations', methods=['POST'])
@jwt_required()
def add_location():
    data = request.json
    print(f"[DEBUG] add_location data: {data}")
    if not data or not data.get('name'):
        return jsonify({"error": "Nombre de ubicación requerido"}), 400
    try:
        new_loc = Location(
            name=data['name'], 
            type=data.get('type', 'internal'),
            dependency_id=data.get('dependency_id')
        )
        db.session.add(new_loc)
        db.session.commit()

        staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
        staff_role_ids = [r.id for r in staff_roles]
        staff_users = User.query.filter(
            User.role_id.in_(staff_role_ids),
            User.is_deleted == False,
            User.is_active == True,
        ).all()
        for su in staff_users:
            db.session.add(Notification(
                user_id=str(su.id),
                type='LOCATION_CREATED',
                title='Nueva ubicación agregada',
                message=f'Se agregó la ubicación "{new_loc.name}".',
                related_type='item',
            ))
        db.session.commit()

        return jsonify({"id": new_loc.id, "name": new_loc.name}), 201
    except Exception as e:
        db.session.rollback()
        print(f"[DEBUG ERROR] add_location: {str(e)}")
        return jsonify({"error": f"Error al crear ubicación: {str(e)}"}), 400

@items_bp.route('/locations/<int:id>', methods=['PUT'])
@jwt_required()
def update_location(id):
    loc = Location.query.get_or_404(id)
    data = request.json
    if not data or not data.get('name'):
        return jsonify({"error": "Nombre de ubicación requerido"}), 400
    try:
        loc.name = data['name']
        if 'type' in data: loc.type = data['type']
        db.session.commit()
        return jsonify({"id": loc.id, "name": loc.name}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[DEBUG ERROR] update_location: {str(e)}")
        return jsonify({"error": f"Error al actualizar ubicación: {str(e)}"}), 400

@items_bp.route('/locations/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_location(id):
    loc = Location.query.get_or_404(id)
    try:
        db.session.delete(loc)
        db.session.commit()
        return jsonify({"message": "Ubicación eliminada"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "No se puede eliminar: tiene elementos asociados"}), 400
