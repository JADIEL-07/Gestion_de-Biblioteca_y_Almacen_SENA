from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.loan import Loan, LoanDetail
from ..models.item import Item
from ..models.user import User, Role
from datetime import datetime, timedelta
from sqlalchemy import func, or_, String

loan_bp = Blueprint('loans', __name__)

@loan_bp.route('/', methods=['GET'])
@jwt_required()
def get_loans():
    search = request.args.get('search', '')
    start_date = request.args.get('startDate', '')
    end_date = request.args.get('endDate', '')
    category = request.args.get('category', 'ALL')

    query = Loan.query.join(User, Loan.user_id == User.id).outerjoin(LoanDetail).outerjoin(Item)

    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Loan.id.cast(String).ilike(search_filter),
                User.name.ilike(search_filter),
                User.email.ilike(search_filter),
                User.phone.ilike(search_filter),
                User.id.ilike(search_filter),
                Item.name.ilike(search_filter),
                Item.code.ilike(search_filter),
                Loan.status.ilike(search_filter)
            )
        )
        
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date).replace(hour=0, minute=0, second=0)
            query = query.filter(Loan.loan_date >= start_dt)
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date).replace(hour=23, minute=59, second=59)
            query = query.filter(Loan.loan_date <= end_dt)
        except ValueError:
            pass
    if category != 'ALL':
        query = query.filter(Item.category.has(name=category))

    loans = query.order_by(Loan.loan_date.desc()).all()
    
    # Pre-fetch all users to avoid N+1 queries
    user_ids = set([loan.user_id for loan in loans] + [loan.admin_id for loan in loans if loan.admin_id])
    users_cache = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
    
    result = []
    for loan in loans:
        user = users_cache.get(loan.user_id)
        admin = users_cache.get(loan.admin_id) if loan.admin_id else None
        items = []
        for detail in loan.details:
            items.append({
                "id": detail.item_id,
                "name": detail.item.name if detail.item else "Ítem eliminado",
                "category": detail.item.category.name if detail.item and detail.item.category else "N/A",
                "nit": detail.item.nit if detail.item else None,
                "delivery_status": detail.delivery_status,
                "return_status": detail.return_status
            })
        
        result.append({
            "id": loan.id,
            "user_id": loan.user_id,
            "user_name": user.name if user else "Usuario eliminado",
            "user_email": user.email if user else "",
            "user_phone": user.phone if user else "",
            "admin_name": admin.name if admin else "Sistema",
            "loan_date": loan.loan_date.isoformat(),
            "due_date": loan.due_date.isoformat(),
            "return_date": loan.return_date.isoformat() if loan.return_date else None,
            "status": loan.status,
            "fine_amount": loan.fine_amount,
            "items": items
        })
    return jsonify(result), 200

@loan_bp.route('/', methods=['POST'])
@jwt_required()
def create_loan():
    data = request.get_json()
    user_id = data.get('user_id')
    item_ids = data.get('item_ids', []) # Lista de IDs de ítems
    days = data.get('days', 7)
    
    if not user_id or not item_ids:
        return jsonify({"error": "Faltan datos obligatorios"}), 400
        
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404
        
    from ..models.reservation import Reservation
    from ..services.reservation_queue import (
        push_notification, is_item_available_for_loan,
    )

    loan = Loan(
        user_id=user_id,
        admin_id=get_jwt_identity(),
        due_date=datetime.now() + timedelta(days=days),
        status='ACTIVE'
    )
    db.session.add(loan)
    db.session.flush()

    item_names = []
    for item_id in item_ids:
        item = Item.query.get(item_id)
        if not item:
            db.session.rollback()
            return jsonify({"error": f"Ítem {item_id} no existe"}), 404
        item_names.append(item.name)

        # ¿Este usuario tiene una reserva READY de este ítem? Consumirla.
        ready_res = Reservation.query.filter_by(
            user_id=str(user_id), item_id=item_id, status='READY'
        ).first()

        if ready_res:
            ready_res.status = 'CLAIMED'
            ready_res.converted_at = datetime.utcnow()
            ready_res.converted_loan_id = loan.id
        else:
            # Sin reserva: solo se permite si hay unidad libre y nadie en READY
            if not is_item_available_for_loan(item):
                db.session.rollback()
                return jsonify({
                    "error": f"El ítem '{item.name}' no está disponible (puede haber reservas en cola)"
                }), 400

        detail = LoanDetail(loan_id=loan.id, item_id=item_id, delivery_status='GOOD')
        from ..models.item import Status
        loaned_status = Status.query.filter_by(name='LOANED').first()
        if not loaned_status:
            loaned_status = Status(name='LOANED')
            db.session.add(loaned_status)
            db.session.flush()
        item.status_id = loaned_status.id
        db.session.add(detail)

    admin_user = User.query.get(str(get_jwt_identity()))
    admin_name = admin_user.name if admin_user else "El encargado"
    items_str = ", ".join(item_names)

    push_notification(
        user_id, 'LOAN_CREATED',
        'Préstamo aprobado',
        f'{admin_name} te aceptó el préstamo del {items_str}.',
        related_type='loan', related_id=loan.id,
    )
    staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
    staff_role_ids = [r.id for r in staff_roles]
    staff_users = User.query.filter(
        User.role_id.in_(staff_role_ids),
        User.is_deleted == False,
        User.is_active == True,
    ).all()
    for su in staff_users:
        push_notification(
            su.id, 'LOAN_CREATED',
            'Nuevo préstamo realizado',
            f'{admin_name} realizó un préstamo de {items_str} a {user.name}.',
            related_type='loan', related_id=loan.id,
        )
    db.session.commit()
    return jsonify({"success": True, "message": "Préstamo creado exitosamente", "loan_id": loan.id}), 201

@loan_bp.route('/from_reservation', methods=['POST'])
@jwt_required()
def create_loan_from_reservation():
    data = request.get_json()
    token = data.get('token')
    days = data.get('days', 7)
    
    if not token:
        return jsonify({"error": "Falta el token de reserva"}), 400
        
    from ..models.reservation import Reservation
    res = Reservation.query.filter_by(token=token).first()
    if not res:
        return jsonify({"error": "Reserva no encontrada o token inválido"}), 404
        
    if res.status not in ('QUEUED', 'READY'):
        return jsonify({"error": f"La reserva no se puede convertir (estado actual: {res.status})"}), 400
        
    user_id = res.user_id
    item_id = res.item_id
    item = Item.query.get(item_id)
    
    if not item:
        return jsonify({"error": "El ítem reservado ya no existe"}), 404
        
    from ..services.reservation_queue import push_notification
    
    loan = Loan(
        user_id=user_id,
        admin_id=get_jwt_identity(),
        due_date=datetime.now() + timedelta(days=days),
        status='ACTIVE'
    )
    db.session.add(loan)
    db.session.flush()
    
    detail = LoanDetail(loan_id=loan.id, item_id=item_id, delivery_status='GOOD')
    from ..models.item import Status
    loaned_status = Status.query.filter_by(name='LOANED').first()
    if not loaned_status:
        loaned_status = Status(name='LOANED')
        db.session.add(loaned_status)
        db.session.flush()
    item.status_id = loaned_status.id
    db.session.add(detail)
    
    res.status = 'CLAIMED'
    res.converted_at = datetime.utcnow()
    res.converted_loan_id = loan.id
    
    admin_user = User.query.get(str(get_jwt_identity()))
    admin_name = admin_user.name if admin_user else "El encargado"

    push_notification(
        user_id, 'LOAN_CREATED',
        'Préstamo aprobado',
        f'{admin_name} te aceptó el préstamo del {item.name}.',
        related_type='loan', related_id=loan.id,
    )
    db.session.commit()
    return jsonify({"success": True, "message": "Préstamo creado desde reserva", "loan_id": loan.id}), 201


@loan_bp.route('/<int:id>/return', methods=['POST'])
@jwt_required()
def return_loan(id):
    loan = Loan.query.get_or_404(id)
    data = request.get_json() or {}

    loan.return_date = datetime.now()
    loan.status = 'RETURNED'

    affected_items = []
    for detail in loan.details:
        item = Item.query.get(detail.item_id)
        if item:
            from ..models.item import Status
            avail_status = Status.query.filter_by(name='AVAILABLE').first()
            if avail_status:
                item.status_id = avail_status.id
            detail.return_status = data.get('return_status', 'GOOD')
            affected_items.append(detail.item_id)

    # Notificar al aprendiz que el préstamo fue cerrado
    from ..services.reservation_queue import push_notification, on_item_available
    push_notification(
        loan.user_id, 'LOAN_RETURNED',
        'Préstamo cerrado',
        f'Tu préstamo #{loan.id} se marcó como devuelto. ¡Gracias!',
        related_type='loan', related_id=loan.id,
    )

    # Multa si es tarde
    if datetime.now() > loan.due_date:
        loan.fine_amount = 5000.0

    db.session.commit()

    # Promover la cola de cada ítem liberado
    for item_id in set(affected_items):
        on_item_available(item_id)
    db.session.commit()

    return jsonify({"success": True, "message": "Préstamo devuelto exitosamente"}), 200

@loan_bp.route('/my', methods=['GET'])
@jwt_required()
def get_my_loans():
    user_id = get_jwt_identity()
    loans = Loan.query.filter_by(user_id=user_id).order_by(Loan.loan_date.desc()).all()
    result = []
    for loan in loans:
        items = []
        for detail in loan.details:
            items.append({
                "id": detail.item_id,
                "name": detail.item.name if detail.item else "Ítem eliminado",
                "code": detail.item.code if detail.item else "N/A",
                "category": detail.item.category.name if detail.item and detail.item.category else "N/A",
                "image_url": detail.item.image_url if detail.item else None
            })
        result.append({
            "id": loan.id,
            "loan_date": loan.loan_date.isoformat(),
            "due_date": loan.due_date.isoformat(),
            "return_date": loan.return_date.isoformat() if loan.return_date else None,
            "status": loan.status,
            "fine_amount": loan.fine_amount,
            "items": items
        })
    return jsonify(result), 200
