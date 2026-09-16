from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.item import Item, Category, Status, Location
from ..models.movement import Notification
from ..models.user import User, Role
from ..models.saved_item import SavedItem
from sqlalchemy import or_, String

items_bp = Blueprint('items', __name__)

# Roles cuyo inventario queda "encerrado" en su propia área de servicio
# (Biblioteca/Almacén): nunca ven ni pueden tocar elementos, categorías o
# ubicaciones de la otra área, sin importar qué les mande el cliente.
STAFF_INVENTORY_ROLES = ('BIBLIOTECARIO', 'ALMACENISTA')


def _requester_scope():
    """(usuario, nombre_de_rol, is_staff_scoped, own_dependency_id) del JWT
    actual. Con optional=True en la ruta, uid puede venir vacío (invitado)."""
    uid = get_jwt_identity()
    if not uid:
        return None, '', False, None
    user = User.query.get(uid)
    if not user:
        return None, '', False, None
    role_name = (user.role.name if user.role else '').strip().upper()
    is_staff_scoped = role_name in STAFF_INVENTORY_ROLES
    return user, role_name, is_staff_scoped, user.dependency_id


def _pick_default(model, dependency_id):
    """Elige un valor por defecto (Location o Category) para cuando no se
    especifica uno: primero de esa misma área, si no hay ninguna, uno
    "compartido" (dependency_id NULL, de datos anteriores a esta
    separación), y en último caso cualquiera."""
    return (model.query.filter_by(dependency_id=dependency_id).first()
            or model.query.filter_by(dependency_id=None).first()
            or model.query.first())


def _full_media_url(path):
    """Normaliza rutas de media a una ruta RELATIVA ('/uploads/...').
    Así funcionan igual en dev (proxy de Vite) y en producción (nginx) sin
    hornear el host en la respuesta. Repara además valores absolutos que
    hayan quedado guardados en la BD (http://host/uploads/...)."""
    if not isinstance(path, str) or not path:
        return None
    if path.startswith('data:'):
        return path
    if path.startswith(('http://', 'https://')):
        idx = path.find('/uploads/')
        return path[idx:] if idx != -1 else path
    return path

def serialize_item(item, saved_ids=None):
    """Serializa un objeto Item a diccionario de forma segura.
    `saved_ids`: set con los ids de elementos que el usuario actual guardó
    (bookmark), para marcar `is_saved` sin hacer una consulta por elemento."""
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
        "image_url": _full_media_url(item.image_url),
        "stock": item.stock if item.stock is not None else 1,
        "description": item.description or "",
        "physical_condition": item.physical_condition or "",
        "is_saved": bool(saved_ids) and item.id in saved_ids,
    }

@items_bp.route('/', methods=['GET'])
@jwt_required(optional=True)
def get_items():
    search = request.args.get('search', '')
    cat_id = request.args.get('category_id')
    stat_id = request.args.get('status_id')
    loc_id = request.args.get('location_id')

    # Los elementos dados de baja (soft delete) no se listan más, pero sus
    # filas siguen existiendo en la BD — así el historial de préstamos,
    # reservas y mantenimiento que los referencia se sigue viendo con su
    # nombre real en vez de "Ítem eliminado".
    query = Item.query.filter(Item.is_deleted == False)

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
        
    # Filtro de seguridad/separación por Dependencia (Biblioteca vs Almacén).
    # A un Bibliotecario/Almacenista esto NO se lo dejamos elegir: se fuerza
    # siempre a su propia área, sin importar qué dependency_id mande el
    # cliente (así nunca ve, ni con la consola del navegador, el inventario
    # de la otra área). Para Admin/Aprendiz/invitado se respeta el filtro
    # opcional que manden (o ninguno = ven de todas las áreas).
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped and not own_dep_id:
        # Cuenta de staff sin área de servicio asignada: por seguridad no ve
        # nada (mejor eso a verlo "todo" por accidente).
        query = query.filter(Item.id < 0)
    else:
        dep_id = own_dep_id if is_staff_scoped else request.args.get('dependency_id')
        if dep_id and dep_id not in ['ALL', '', 'undefined', 'null']:
            # OJO: se incluyen también los elementos cuya ubicación tiene
            # dependency_id NULL ("compartida"/de antes de esta separación
            # por áreas) — si no, TODO el inventario creado antes de esta
            # función quedaba invisible para Bibliotecario/Almacenista (el
            # Admin sí lo seguía viendo porque no aplica este filtro).
            query = query.join(Location, Item.location_id == Location.id).filter(
                or_(Location.dependency_id == dep_id, Location.dependency_id.is_(None))
            )

    try:
        items = query.order_by(Item.id.desc()).all()

        user_id = get_jwt_identity()
        saved_ids = set()
        if user_id:
            saved_ids = {
                row.item_id for row in
                SavedItem.query.filter_by(user_id=user_id).with_entities(SavedItem.item_id).all()
            }

        # Los elementos guardados (bookmark) van primero — es solo prioridad
        # visual para encontrarlos rápido, NO reordena ni afecta la cola de
        # reservas (que sigue por orden de llegada, igual para todos).
        if saved_ids:
            items = sorted(items, key=lambda i: i.id not in saved_ids)

        return jsonify([serialize_item(i, saved_ids) for i in items])
    except Exception as e:
        print(f"[ERROR] get_items: {e}")
        return jsonify({"error": str(e)}), 500


@items_bp.route('/saved', methods=['GET'])
@jwt_required()
def get_saved_items():
    """Lista de elementos que el usuario actual guardó (bookmark), del más
    reciente al más antiguo — para la sección "Favoritos" del catálogo."""
    user_id = get_jwt_identity()
    saved = (SavedItem.query.filter_by(user_id=user_id)
             .order_by(SavedItem.created_at.desc()).all())
    saved_ids = {s.item_id for s in saved}
    items_by_id = {i.id: i for i in Item.query.filter(Item.id.in_(saved_ids), Item.is_deleted == False).all()}
    # Se respeta el orden de "guardado más reciente primero"; si un elemento
    # ya no existe (o fue dado de baja) se omite en silencio.
    ordered = [items_by_id[s.item_id] for s in saved if s.item_id in items_by_id]
    return jsonify([serialize_item(i, saved_ids) for i in ordered])


@items_bp.route('/<int:id>/save', methods=['POST'])
@jwt_required()
def toggle_save_item(id):
    """Alterna si el usuario actual tiene guardado (bookmark) este elemento."""
    user_id = get_jwt_identity()
    item = Item.query.get_or_404(id)
    existing = SavedItem.query.filter_by(user_id=user_id, item_id=item.id).first()
    if existing:
        db.session.delete(existing)
        db.session.commit()
        return jsonify({"saved": False}), 200
    db.session.add(SavedItem(user_id=user_id, item_id=item.id))
    db.session.commit()
    return jsonify({"saved": True}), 201

@items_bp.route('/filters', methods=['GET'])
@jwt_required(optional=True)
def get_item_filters():
    # Mismo forzado que en GET /items/: un Bibliotecario/Almacenista jamás
    # recibe las ubicaciones/categorías de la otra área, sin importar qué
    # dependency_id venga en la URL.
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    dep_id = own_dep_id if is_staff_scoped else request.args.get('dependency_id')
    try:
        from ..models.dependency import Dependency
        statuses = Status.query.all()
        dependencies = Dependency.query.all()

        cat_query = Category.query
        loc_query = Location.query
        if dep_id and dep_id not in ['ALL', '', 'undefined', 'null']:
            # Se incluyen también las de dependency_id NULL (categorías/
            # ubicaciones "compartidas" de antes de esta separación).
            cat_query = cat_query.filter(or_(Category.dependency_id == dep_id, Category.dependency_id.is_(None)))
            loc_query = loc_query.filter(or_(Location.dependency_id == dep_id, Location.dependency_id.is_(None)))
        elif is_staff_scoped:
            # Staff sin área asignada: no ve ninguna (ver mismo criterio en GET /items/).
            cat_query = cat_query.filter(Category.id < 0)
            loc_query = loc_query.filter(Location.id < 0)
        categories = cat_query.all()
        locations = loc_query.all()

        return jsonify({
            "categories": [{"id": c.id, "name": c.name, "dependency_id": c.dependency_id} for c in categories],
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

import uuid

def save_image(image_data, prefix="item"):
    """Guarda la foto DIRECTAMENTE en la BD como data URL, sin tocar el disco.

    Antes se escribía a /app/app/uploads y se guardaba solo la ruta en la BD.
    El problema: el disco del contenedor no es persistente entre despliegues
    (cada `git push` reconstruye el contenedor), así que el archivo físico
    desaparecía en el siguiente deploy aunque la ruta siguiera en la BD —
    de ahí que las imágenes "no se guardaran". Se guarda igual que ya se
    hace con las fotos del chat de soporte: la data URL completa en la
    columna (TEXT, sin límite), que sobrevive cualquier redeploy porque
    vive en Postgres, no en el contenedor.
    """
    if not image_data or not isinstance(image_data, str):
        return image_data
    if not image_data.startswith('data:image'):
        return image_data  # Ya es una URL/ruta existente (http, /uploads/..., etc.) — se deja igual.
    if len(image_data) > 8_000_000:
        print(f"[item-image] imagen rechazada por tamaño ({len(image_data)} bytes)")
        return None
    return image_data

@items_bp.route('/', methods=['POST'])
@jwt_required()
def add_item():
    data = request.json
    if not data:
        return jsonify({"error": "No se recibieron datos"}), 400

    # ── Área de servicio (regla de separación Biblioteca/Almacén) ──
    # Un Bibliotecario/Almacenista SIEMPRE crea en su propia área — se
    # ignora cualquier dependency_id que venga en el body. Un Admin (u otro
    # rol con acceso) debe indicarlo explícitamente: es quien elige en qué
    # área de servicio se crea el elemento.
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped:
        dependency_id = own_dep_id
        if not dependency_id:
            return jsonify({"error": "Tu cuenta no tiene un área de servicio asignada. Contacta a un administrador."}), 400
    else:
        try:
            dependency_id = int(data.get('dependency_id')) if data.get('dependency_id') not in (None, '', 'ALL') else None
        except (TypeError, ValueError):
            dependency_id = None
        if not dependency_id:
            return jsonify({"error": "Selecciona el área de servicio donde se creará el elemento."}), 400

    # Handle category_id with safe conversion
    raw_category_id = data.get('category_id')
    try:
        category_id = int(raw_category_id)
    except (TypeError, ValueError):
        category_id = None
    if not category_id:
        default_cat = _pick_default(Category, dependency_id)
        category_id = default_cat.id if default_cat else None

    # Handle location_id with safe conversion
    raw_location_id = data.get('location_id')
    try:
        location_id = int(raw_location_id)
    except (TypeError, ValueError):
        location_id = None
    if not location_id:
        default_loc = _pick_default(Location, dependency_id)
        location_id = default_loc.id if default_loc else None

    # La ubicación y la categoría elegidas (o las que se acaban de resolver
    # por defecto) tienen que pertenecer a esa misma área de servicio — así
    # ni siquiera manipulando la petición se puede colar un elemento en la
    # ubicación/categoría de la otra área. Se acepta dependency_id NULL
    # (categorías/ubicaciones "compartidas" de antes de esta separación).
    location = Location.query.get(location_id) if location_id else None
    if not location or (location.dependency_id is not None and location.dependency_id != dependency_id):
        return jsonify({"error": "La ubicación seleccionada no pertenece al área de servicio elegida."}), 400

    category = Category.query.get(category_id) if category_id else None
    if not category or (category.dependency_id is not None and category.dependency_id != dependency_id):
        return jsonify({"error": "La categoría seleccionada no pertenece al área de servicio elegida."}), 400

    item_code = data.get('code') or data.get('codigo')
    if not item_code:
        item_code = f"ITEM-{uuid.uuid4().hex[:8].upper()}"

    # Determine status_id from input or fallback to AVAILABLE/default
    raw_status_id = data.get('status_id')
    try:
        status_id = int(raw_status_id) if raw_status_id is not None else None
    except (TypeError, ValueError):
        status_id = None
    if not status_id:
        default_status = Status.query.filter_by(name='AVAILABLE').first() or Status.query.first()
        status_id = default_status.id if default_status else None

    # Procesar imagen
    image_url = save_image(data.get('image_url'))

    new_item = Item(
        name=data.get('name') or data.get('nombre'),
        description=data.get('description') or data.get('descripcion'),
        code=item_code,
        category_id=category_id,
        location_id=location_id,
        status_id=status_id,
        supplier_id=data.get('supplier_id'),
        brand=data.get('brand'),
        model=data.get('model'),
        serial_number=data.get('serial_number') or None,
        image_url=image_url,
        stock=data.get('stock', 1),
        physical_condition=data.get('physical_condition') or "EXCELENTE",
    )
    try:
        db.session.add(new_item)
        db.session.commit()

        staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
        staff_role_ids = [r.id for r in staff_roles]
        # Solo se avisa al staff de la MISMA área de servicio — si no, un
        # Bibliotecario terminaba enterándose de altas del Almacén y viceversa.
        staff_users = User.query.filter(
            User.role_id.in_(staff_role_ids),
            User.dependency_id == dependency_id,
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
        if "ForeignKeyViolation" in error_msg:
            if "category_id" in error_msg:
                return jsonify({"error": "La categoría seleccionada no existe. Crea una categoría primero."}), 400
            if "location_id" in error_msg:
                return jsonify({"error": "La ubicación seleccionada no existe. Crea una ubicación primero."}), 400
            if "status_id" in error_msg:
                return jsonify({"error": "Error interno: No hay estados registrados en la base de datos."}), 400
        return jsonify({"error": "Error de validación: Verifique que todos los campos obligatorios estén llenos"}), 400

@items_bp.route('/<int:id>', methods=['PUT'])
@jwt_required()
def update_item(id):
    item = Item.query.get_or_404(id)
    data = request.json
    if not data:
        return jsonify({"error": "No se recibieron datos"}), 400

    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped:
        current_loc = Location.query.get(item.location_id)
        if not current_loc or (current_loc.dependency_id is not None and current_loc.dependency_id != own_dep_id):
            return jsonify({"error": "No puedes editar un elemento de otra área de servicio."}), 403

    # Si se está tocando la ubicación y/o la categoría, se validan JUNTAS
    # antes de aplicar nada: deben terminar perteneciendo a la misma área de
    # servicio entre sí (y, si es staff, a la suya propia). Así la edición
    # no se puede usar como atajo para dejar un elemento con, por ejemplo,
    # la ubicación de Biblioteca y la categoría de Almacén.
    touching_location = 'location_id' in data and data['location_id']
    touching_category = 'category_id' in data and data['category_id']
    if touching_location or touching_category:
        new_loc_id = int(data['location_id']) if touching_location else item.location_id
        new_cat_id = int(data['category_id']) if touching_category else item.category_id

        loc = Location.query.get(new_loc_id)
        if not loc:
            return jsonify({"error": "La ubicación seleccionada no existe."}), 400
        cat = Category.query.get(new_cat_id)
        if not cat:
            return jsonify({"error": "La categoría seleccionada no existe."}), 400

        if is_staff_scoped:
            if loc.dependency_id is not None and loc.dependency_id != own_dep_id:
                return jsonify({"error": "No puedes mover este elemento a una ubicación de otra área de servicio."}), 403
            if cat.dependency_id is not None and cat.dependency_id != own_dep_id:
                return jsonify({"error": "No puedes asignar una categoría de otra área de servicio."}), 403

        # Si ambas tienen área asignada (no son "compartidas"), deben coincidir.
        if loc.dependency_id is not None and cat.dependency_id is not None and loc.dependency_id != cat.dependency_id:
            return jsonify({"error": "La ubicación y la categoría elegidas pertenecen a áreas de servicio distintas."}), 400

        item.location_id = new_loc_id
        item.category_id = new_cat_id

    # Actualizar el resto de los campos enviados
    if 'name' in data:       item.name        = data['name']
    if 'code' in data and data['code'].strip(): item.code = data['code'].strip()
    if 'description' in data: item.description = data['description']
    if 'brand' in data:      item.brand       = data['brand']
    if 'model' in data:      item.model       = data['model']
    if 'serial_number' in data:
        item.serial_number = data['serial_number'] or None
    if 'stock' in data:      item.stock       = int(data['stock'])
    if 'image_url' in data:  item.image_url   = save_image(data['image_url'])
    if 'physical_condition' in data: item.physical_condition = data['physical_condition'] or None
    if 'status_id' in data and data['status_id']:
        item.status_id   = int(data['status_id'])

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
                return jsonify({"error": "El código (QR/Barras) ya está registrado en otro elemento"}), 400
            if "items.serial_number" in error_msg:
                return jsonify({"error": "El número de serie ya está registrado"}), 400
        # Foreign key violations
        if "items.category_id" in error_msg:
            return jsonify({"error": "La categoría seleccionada no existe. Crea una categoría primero."}), 400
        if "items.location_id" in error_msg:
            return jsonify({"error": "La ubicación seleccionada no existe. Crea una ubicación primero."}), 400
        if "items.status_id" in error_msg:
            return jsonify({"error": "Error interno: No hay estados registrados en la base de datos."}), 400
        return jsonify({"error": "Error de validación: Verifique que todos los campos obligatorios estén llenos"}), 400

@items_bp.route('/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_item(id):
    item = Item.query.get_or_404(id)
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped:
        loc = Location.query.get(item.location_id)
        if not loc or (loc.dependency_id is not None and loc.dependency_id != own_dep_id):
            return jsonify({"error": "No puedes eliminar un elemento de otra área de servicio."}), 403

    # Esto SÍ debe bloquear el borrado: hay un compromiso vigente con
    # alguien (lo tiene prestado o está en cola para reclamarlo).
    from ..models.loan import Loan, LoanDetail
    from ..models.reservation import Reservation
    active_loan = (db.session.query(LoanDetail)
                   .join(Loan, LoanDetail.loan_id == Loan.id)
                   .filter(LoanDetail.item_id == id, Loan.status.in_(['ACTIVE', 'OVERDUE', 'NOT_RETURNED']))
                   .first())
    if active_loan:
        return jsonify({"error": "No se puede eliminar: el elemento tiene un préstamo activo o no devuelto."}), 400
    active_reservation = Reservation.query.filter(
        Reservation.item_id == id, Reservation.status.in_(['QUEUED', 'READY'])
    ).first()
    if active_reservation:
        return jsonify({"error": "No se puede eliminar: el elemento tiene una reserva en curso."}), 400

    # Baja lógica (soft delete), NO borrado físico: la fila del elemento se
    # queda en la BD marcada is_deleted=True, así el historial de préstamos,
    # reservas, mantenimiento y movimientos que ya lo referencian se
    # conserva intacto (con su nombre real) — antes fallaba con un error de
    # llave foránea justo por eso, aunque el elemento estuviera "Disponible".
    try:
        SavedItem.query.filter_by(item_id=id).delete()
        item.is_deleted = True
        db.session.commit()
        return jsonify({"message": f"Elemento '{item.name}' eliminado exitosamente"}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[ERROR] delete_item: {e}")
        return jsonify({"error": "No se pudo eliminar el elemento."}), 400
# --- CATEGORIES CRUD ---
@items_bp.route('/categories', methods=['POST'])
@jwt_required()
def add_category():
    data = request.json
    print(f"[DEBUG] add_category data: {data}")
    if not data or not data.get('name'):
        return jsonify({"error": "Nombre de categoría requerido"}), 400

    # Misma regla que al crear un elemento: staff -> su propia área, sin
    # opción a elegir; cualquier otro rol (Admin) tiene que indicarla.
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped:
        dependency_id = own_dep_id
        if not dependency_id:
            return jsonify({"error": "Tu cuenta no tiene un área de servicio asignada. Contacta a un administrador."}), 400
    else:
        try:
            dependency_id = int(data.get('dependency_id')) if data.get('dependency_id') not in (None, '', 'ALL') else None
        except (TypeError, ValueError):
            dependency_id = None
        if not dependency_id:
            return jsonify({"error": "Selecciona a qué área de servicio pertenece esta categoría."}), 400

    try:
        new_cat = Category(name=data['name'], dependency_id=dependency_id)
        db.session.add(new_cat)
        db.session.commit()

        staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
        staff_role_ids = [r.id for r in staff_roles]
        staff_users = User.query.filter(
            User.role_id.in_(staff_role_ids),
            User.dependency_id == dependency_id,
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

        return jsonify({"id": new_cat.id, "name": new_cat.name, "dependency_id": new_cat.dependency_id}), 201
    except Exception as e:
        db.session.rollback()
        error_msg = str(e)
        if "categories_name_key" in error_msg or "UNIQUE constraint failed" in error_msg:
            return jsonify({"error": f"La categoría '{data.get('name')}' ya existe."}), 400
        print(f"[DEBUG ERROR] add_category: {error_msg}")
        return jsonify({"error": "Error al crear la categoría."}), 400

@items_bp.route('/categories/<int:id>', methods=['PUT'])
@jwt_required()
def update_category(id):
    cat = Category.query.get_or_404(id)
    data = request.json
    if not data or not data.get('name'):
        return jsonify({"error": "Nombre de categoría requerido"}), 400

    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped and cat.dependency_id is not None and cat.dependency_id != own_dep_id:
        return jsonify({"error": "No puedes editar una categoría de otra área de servicio."}), 403

    try:
        cat.name = data['name']
        db.session.commit()
        return jsonify({"id": cat.id, "name": cat.name}), 200
    except Exception as e:
        db.session.rollback()
        error_msg = str(e)
        if "categories_name_key" in error_msg or "UNIQUE constraint failed" in error_msg:
            return jsonify({"error": f"La categoría '{data.get('name')}' ya existe."}), 400
        print(f"[DEBUG ERROR] update_category: {error_msg}")
        return jsonify({"error": "Error al actualizar la categoría."}), 400

@items_bp.route('/categories/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_category(id):
    cat = Category.query.get_or_404(id)
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped and cat.dependency_id is not None and cat.dependency_id != own_dep_id:
        return jsonify({"error": "No puedes eliminar una categoría de otra área de servicio."}), 403
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

    # Misma regla: staff -> su propia área (se ignora lo que mande el
    # cliente); Admin/otro rol -> tiene que indicarla.
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped:
        dependency_id = own_dep_id
        if not dependency_id:
            return jsonify({"error": "Tu cuenta no tiene un área de servicio asignada. Contacta a un administrador."}), 400
    else:
        try:
            dependency_id = int(data.get('dependency_id')) if data.get('dependency_id') not in (None, '', 'ALL') else None
        except (TypeError, ValueError):
            dependency_id = None
        if not dependency_id:
            return jsonify({"error": "Selecciona a qué área de servicio pertenece esta ubicación."}), 400

    try:
        new_loc = Location(
            name=data['name'],
            type=data.get('type', 'internal'),
            dependency_id=dependency_id
        )
        db.session.add(new_loc)
        db.session.commit()

        staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
        staff_role_ids = [r.id for r in staff_roles]
        staff_users = User.query.filter(
            User.role_id.in_(staff_role_ids),
            User.dependency_id == dependency_id,
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

        return jsonify({"id": new_loc.id, "name": new_loc.name, "dependency_id": new_loc.dependency_id}), 201
    except Exception as e:
        db.session.rollback()
        error_msg = str(e)
        if "locations_name_key" in error_msg or "UNIQUE constraint failed" in error_msg:
            return jsonify({"error": f"La ubicación '{data.get('name')}' ya existe."}), 400
        print(f"[DEBUG ERROR] add_location: {error_msg}")
        return jsonify({"error": "Error al crear la ubicación."}), 400

@items_bp.route('/locations/<int:id>', methods=['PUT'])
@jwt_required()
def update_location(id):
    loc = Location.query.get_or_404(id)
    data = request.json
    if not data or not data.get('name'):
        return jsonify({"error": "Nombre de ubicación requerido"}), 400

    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped and loc.dependency_id is not None and loc.dependency_id != own_dep_id:
        return jsonify({"error": "No puedes editar una ubicación de otra área de servicio."}), 403

    try:
        loc.name = data['name']
        if 'type' in data: loc.type = data['type']
        db.session.commit()
        return jsonify({"id": loc.id, "name": loc.name}), 200
    except Exception as e:
        db.session.rollback()
        error_msg = str(e)
        if "locations_name_key" in error_msg or "UNIQUE constraint failed" in error_msg:
            return jsonify({"error": f"La ubicación '{data.get('name')}' ya existe."}), 400
        print(f"[DEBUG ERROR] update_location: {error_msg}")
        return jsonify({"error": "Error al actualizar la ubicación."}), 400

@items_bp.route('/locations/<int:id>', methods=['DELETE'])
@jwt_required()
def delete_location(id):
    loc = Location.query.get_or_404(id)
    requester, role_name, is_staff_scoped, own_dep_id = _requester_scope()
    if is_staff_scoped and loc.dependency_id is not None and loc.dependency_id != own_dep_id:
        return jsonify({"error": "No puedes eliminar una ubicación de otra área de servicio."}), 403
    try:
        db.session.delete(loc)
        db.session.commit()
        return jsonify({"message": "Ubicación eliminada"}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "No se puede eliminar: tiene elementos asociados"}), 400
