from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..utils.permissions import role_required, ADMIN, ALL_STAFF
from ..models.item_output import ItemOutput, OutputType, OutputStatus
from ..models.item import Item, Status
from ..models.user import User
from ..models.audit_log import AuditLog
from datetime import datetime
from sqlalchemy import or_, String

output_bp = Blueprint('outputs', __name__)

def get_status_id(name):
    status = Status.query.filter_by(name=name).first()
    if not status:
        status = Status(name=name)
        db.session.add(status)
        db.session.flush()
    return status.id

@output_bp.route('/', methods=['GET'])
@role_required(*ALL_STAFF)
def get_outputs():
    search = request.args.get('search', '')
    status_filter = request.args.get('status', 'ALL')
    
    query = ItemOutput.query.join(Item).join(User, ItemOutput.user_id == User.id)
    
    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Item.name.ilike(search_filter),
                Item.code.ilike(search_filter),
                User.name.ilike(search_filter),
                ItemOutput.destination.ilike(search_filter)
            )
        )
    
    if status_filter != 'ALL':
        query = query.filter(ItemOutput.status == status_filter)
        
    outputs = query.order_by(ItemOutput.created_at.desc()).all()
    return jsonify([o.to_dict() for o in outputs]), 200

@output_bp.route('/', methods=['POST'])
@role_required(*ALL_STAFF)
def create_output():
    data = request.get_json()
    item_id = data.get('item_id')
    output_type = data.get('tipo_salida')
    destination = data.get('destino')
    description = data.get('descripcion')
    estimated_return = data.get('fecha_retorno_estimada')
    reason_code = data.get('reason_code')
    
    admin_id = get_jwt_identity()
    
    if not item_id or not output_type:
        return jsonify({"error": "Item ID y Tipo de Salida son obligatorios"}), 400
    if isinstance(item_id, bool) or not isinstance(item_id, int) or not isinstance(output_type, str):
        return jsonify({"error": "item_id o tipo_salida con formato inválido."}), 400

    estimated_dt = None
    if estimated_return:
        try:
            estimated_dt = datetime.fromisoformat(estimated_return)
        except (TypeError, ValueError):
            return jsonify({"error": "La fecha de retorno estimada no es válida."}), 400
        
    # 1. Bloquear fila para evitar concurrencia
    item = Item.query.with_for_update().get(item_id)
    
    if not item:
        return jsonify({"error": "El elemento no existe"}), 404
        
    # 2. Validaciones
    if item.is_deleted:
        return jsonify({"error": "El elemento ha sido eliminado"}), 400
        
    # Verificar estado (Debe ser AVAILABLE o similar)
    if not item.status_obj or item.status_obj.name != 'AVAILABLE':
         return jsonify({"error": f"El elemento no está disponible para salida (Estado actual: {item.status_obj.name if item.status_obj else 'N/A'})"}), 400

    # 3. Determinar nuevo estado del elemento
    new_status_name = 'AVAILABLE'
    if output_type == OutputType.MAINTENANCE:
        new_status_name = 'IN_MAINTENANCE'
    elif output_type in [OutputType.TRANSFER, OutputType.INTERNAL_USE]:
        new_status_name = 'UNAVAILABLE'
    elif output_type == OutputType.DISPOSAL:
        new_status_name = 'DECOMMISSIONED'
    
    # 4. Crear registro de salida
    new_output = ItemOutput(
        item_id=item_id,
        user_id=admin_id,
        type=output_type,
        status=OutputStatus.ACTIVE,
        destination=destination,
        description=description,
        reason_code=reason_code,
        estimated_return_date=estimated_dt
    )
    
    # 5. Actualizar estado del ítem
    item.status_id = get_status_id(new_status_name)
    
    db.session.add(new_output)
    
    # 6. Auditoría
    audit = AuditLog(
        user_id=admin_id,
        action='SALIDA_CREATED',
        entity='item_output',
        entity_id=str(item_id),
        entity_name=item.name,
        details=f"Salida tipo {output_type} hacia {destination}"
    )
    db.session.add(audit)
    
    try:
        db.session.commit()
        return jsonify({"success": True, "message": "Salida registrada exitosamente", "data": new_output.to_dict()}), 201
    except Exception as e:
        db.session.rollback()
        print(f"[ERROR] create_output: {e}")
        return jsonify({"error": "Error al procesar la salida."}), 500

@output_bp.route('/<int:id>/return', methods=['PATCH'])
@role_required(*ALL_STAFF)
def register_return(id):
    output = ItemOutput.query.get_or_404(id)
    data = request.get_json(silent=True) or {}
    
    if output.status != OutputStatus.ACTIVE:
        return jsonify({"error": "Esta salida no está activa"}), 400
        
    if output.type == OutputType.DISPOSAL:
        return jsonify({"error": "No se puede retornar un elemento en disposición final"}), 400
        
    item = Item.query.get(output.item_id)
    
    # Actualizar salida
    output.status = OutputStatus.RETURNED
    output.actual_return_date = datetime.now()
    
    # Actualizar ítem (Vuelve a estar disponible)
    item.status_id = get_status_id('AVAILABLE')
    
    # Auditoría
    audit = AuditLog(
        user_id=get_jwt_identity(),
        action='SALIDA_RETURNED',
        entity='item_output',
        entity_id=str(output.id),
        entity_name=item.name,
        details=f"Retorno registrado. Condición reportada: {data.get('condicion', 'N/A')}"
    )
    db.session.add(audit)
    
    db.session.commit()
    return jsonify({"success": True, "message": "Retorno registrado exitosamente"}), 200

@output_bp.route('/<int:id>/close', methods=['PATCH'])
@role_required(*ALL_STAFF)
def close_output(id):
    output = ItemOutput.query.get_or_404(id)
    
    if output.status != OutputStatus.ACTIVE:
        return jsonify({"error": "Solo se pueden cerrar salidas activas"}), 400
        
    item = Item.query.get(output.item_id)
    
    # Actualizar salida
    output.status = OutputStatus.CLOSED
    
    # Estado final del elemento según tipo
    if output.type == OutputType.DISPOSAL:
        item.status_id = get_status_id('DECOMMISSIONED')
    elif output.type == OutputType.TRANSFER:
        item.status_id = get_status_id('UNAVAILABLE')
    
    # Auditoría
    audit = AuditLog(
        user_id=get_jwt_identity(),
        action='SALIDA_CLOSED',
        entity='item_output',
        entity_id=str(output.id),
        entity_name=item.name,
        details=f"Salida cerrada permanentemente (Tipo: {output.type})"
    )
    db.session.add(audit)
    
    db.session.commit()
    return jsonify({"success": True, "message": "Salida cerrada permanentemente"}), 200
