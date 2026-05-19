from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import or_, and_, func
from datetime import datetime

from ..extensions import db
from ..models.ticket import Ticket
from ..models.user import User, Role
from ..models.chat_message import TicketMessage, StaffMessage

chat_bp = Blueprint('chat', __name__)


# ─── Helpers ─────────────────────────────────────────────────────────────────
APPRENTICE_ROLES = {'APRENDIZ', 'USUARIO'}
STAFF_ROLES = {'BIBLIOTECARIO', 'ALMACENISTA', 'SOPORTE TÉCNICO', 'SOPORTE TECNICO', 'SOPORTE_TECNICO', 'SOPORTE', 'ADMIN'}


def _role_name(user):
    return (user.role.name.upper() if user and user.role else '').strip()


def _is_support(role_name):
    return 'SOPORTE' in role_name


def _is_apprentice(role_name):
    return role_name in APPRENTICE_ROLES


def _is_staff(role_name):
    return role_name in STAFF_ROLES or _is_support(role_name)


def _serialize_message(msg, current_user_id):
    sender = msg.sender
    return {
        'id': msg.id,
        'body': msg.body,
        'sender_id': msg.sender_id,
        'sender_name': sender.name if sender else 'Desconocido',
        'sender_role': (sender.role.name if sender and sender.role else None),
        'is_mine': msg.sender_id == current_user_id,
        'is_read': msg.is_read,
        'created_at': msg.created_at.isoformat() if msg.created_at else None,
    }


# ─── TICKET CHAT (Aprendiz <-> Soporte) ──────────────────────────────────────
@chat_bp.route('/tickets/<int:ticket_id>/messages', methods=['GET'])
@jwt_required()
def get_ticket_messages(ticket_id):
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    ticket = Ticket.query.filter_by(id=ticket_id, is_deleted=False).first()
    if not ticket:
        return jsonify({'error': 'Ticket no encontrado'}), 404

    role_name = _role_name(user)
    is_admin = role_name == 'ADMIN'
    is_reporter = ticket.user_id == user.id
    is_assignee = ticket.assigned_to == user.id
    # Soporte puede ver tickets sin asignar (bandeja entrante) sin tomarlos aún
    can_view_inbox = _is_support(role_name) and ticket.assigned_to is None

    # REGLA DE ORO: solo el aprendiz que creó el ticket, el soporte asignado,
    # cualquier soporte (para bandeja) o admin pueden ver el chat.
    if not (is_reporter or is_assignee or is_admin or can_view_inbox):
        return jsonify({'error': 'No tienes acceso a este chat.'}), 403

    messages = TicketMessage.query.filter_by(ticket_id=ticket_id).order_by(TicketMessage.created_at.asc()).all()

    # Marcar como leídos los mensajes que NO envió el usuario actual
    unread = [m for m in messages if not m.is_read and m.sender_id != user.id]
    for m in unread:
        m.is_read = True
    if unread:
        db.session.commit()

    return jsonify({
        'ticket': {
            'id': ticket.id,
            'subject': ticket.subject,
            'description': ticket.description,
            'status': ticket.status,
            'severity': ticket.severity,
            'reporter_id': ticket.user_id,
            'assigned_to': ticket.assigned_to,
        },
        'messages': [_serialize_message(m, user.id) for m in messages],
    }), 200


@chat_bp.route('/tickets/<int:ticket_id>/messages', methods=['POST'])
@jwt_required()
def post_ticket_message(ticket_id):
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    ticket = Ticket.query.filter_by(id=ticket_id, is_deleted=False).first()
    if not ticket:
        return jsonify({'error': 'Ticket no encontrado'}), 404

    role_name = _role_name(user)
    is_reporter = ticket.user_id == user.id
    is_assignee = ticket.assigned_to == user.id

    # REGLA DE ORO: si el ticket aún no tiene assignee y el usuario es soporte, lo toma automáticamente
    if not is_assignee and not is_reporter and _is_support(role_name) and ticket.assigned_to is None:
        ticket.assigned_to = user.id
        if ticket.status == 'OPEN':
            ticket.status = 'IN_PROGRESS'
        db.session.commit()
        is_assignee = True

    if not (is_reporter or is_assignee):
        return jsonify({'error': 'No tienes permiso para escribir en este chat.'}), 403

    if ticket.status in ('CLOSED', 'CANCELLED'):
        return jsonify({'error': 'Este ticket está cerrado.'}), 400

    data = request.get_json() or {}
    body = (data.get('body') or '').strip()
    if not body:
        return jsonify({'error': 'El mensaje no puede estar vacío.'}), 400
    if len(body) > 4000:
        return jsonify({'error': 'El mensaje excede el largo permitido (4000 caracteres).'}), 400

    msg = TicketMessage(ticket_id=ticket_id, sender_id=user.id, body=body)
    db.session.add(msg)
    db.session.commit()

    return jsonify(_serialize_message(msg, user.id)), 201


@chat_bp.route('/tickets/<int:ticket_id>/close', methods=['PUT'])
@jwt_required()
def close_ticket(ticket_id):
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    ticket = Ticket.query.filter_by(id=ticket_id, is_deleted=False).first()
    if not ticket:
        return jsonify({'error': 'Ticket no encontrado'}), 404

    role_name = _role_name(user)
    if ticket.assigned_to != user.id and role_name != 'ADMIN':
        return jsonify({'error': 'Solo el soporte asignado o un admin puede cerrar el caso.'}), 403

    ticket.status = 'CLOSED'
    ticket.closed_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'message': 'Ticket cerrado correctamente.', 'status': ticket.status}), 200


@chat_bp.route('/tickets/mine', methods=['GET'])
@jwt_required()
def get_my_tickets():
    """Endpoint para el Aprendiz: ver sus propios tickets con resumen del chat."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    tickets = Ticket.query.filter_by(user_id=user.id, is_deleted=False).order_by(Ticket.created_at.desc()).all()

    result = []
    for t in tickets:
        assignee = User.query.get(t.assigned_to) if t.assigned_to else None
        last_msg = TicketMessage.query.filter_by(ticket_id=t.id).order_by(TicketMessage.created_at.desc()).first()
        unread_count = TicketMessage.query.filter(
            TicketMessage.ticket_id == t.id,
            TicketMessage.is_read == False,
            TicketMessage.sender_id != user.id,
        ).count()

        result.append({
            'id': t.id,
            'subject': t.subject,
            'status': t.status,
            'severity': t.severity,
            'assigned_to_name': assignee.name if assignee else None,
            'created_at': t.created_at.isoformat() if t.created_at else None,
            'last_message': (last_msg.body[:120] if last_msg else None),
            'last_message_at': (last_msg.created_at.isoformat() if last_msg and last_msg.created_at else None),
            'unread_count': unread_count,
        })

    return jsonify(result), 200


@chat_bp.route('/tickets/assigned', methods=['GET'])
@jwt_required()
def get_assigned_tickets():
    """Endpoint para Soporte: ver tickets asignados a mí + los abiertos sin asignar."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    role_name = _role_name(user)
    if not _is_support(role_name) and role_name != 'ADMIN':
        return jsonify({'error': 'No autorizado.'}), 403

    # Mis casos + casos sin asignar (bandeja)
    tickets = Ticket.query.filter(
        Ticket.is_deleted == False,
        or_(Ticket.assigned_to == user.id, Ticket.assigned_to == None),
    ).order_by(Ticket.created_at.desc()).all()

    result = []
    for t in tickets:
        reporter = User.query.get(t.user_id)
        last_msg = TicketMessage.query.filter_by(ticket_id=t.id).order_by(TicketMessage.created_at.desc()).first()
        unread_count = TicketMessage.query.filter(
            TicketMessage.ticket_id == t.id,
            TicketMessage.is_read == False,
            TicketMessage.sender_id != user.id,
        ).count() if t.assigned_to == user.id else 0

        result.append({
            'id': t.id,
            'subject': t.subject,
            'status': t.status,
            'severity': t.severity,
            'reporter_name': reporter.name if reporter else 'N/A',
            'reporter_id': t.user_id,
            'assigned_to': t.assigned_to,
            'is_mine': t.assigned_to == user.id,
            'is_unassigned': t.assigned_to is None,
            'created_at': t.created_at.isoformat() if t.created_at else None,
            'last_message': (last_msg.body[:120] if last_msg else None),
            'last_message_at': (last_msg.created_at.isoformat() if last_msg and last_msg.created_at else None),
            'unread_count': unread_count,
        })

    return jsonify(result), 200


# ─── STAFF CHAT (Bibliotecario, Almacenista, Soporte, Admin) ─────────────────
@chat_bp.route('/staff/contacts', methods=['GET'])
@jwt_required()
def get_staff_contacts():
    """Lista de usuarios con los que el staff puede chatear (excluyendo aprendices)."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    role_name = _role_name(user)
    if _is_apprentice(role_name):
        return jsonify({'error': 'Los aprendices no tienen acceso al chat interno.'}), 403

    # Obtener roles altos
    high_roles = Role.query.filter(Role.name.in_([
        'BIBLIOTECARIO', 'ALMACENISTA', 'SOPORTE TÉCNICO', 'SOPORTE TECNICO',
        'SOPORTE_TECNICO', 'SOPORTE', 'ADMIN'
    ])).all()
    high_role_ids = [r.id for r in high_roles]

    contacts = User.query.filter(
        User.role_id.in_(high_role_ids),
        User.id != user.id,
        User.is_deleted == False,
        User.is_active == True,
    ).all()

    result = []
    for c in contacts:
        # Último mensaje de la conversación
        last_msg = StaffMessage.query.filter(
            or_(
                and_(StaffMessage.sender_id == user.id, StaffMessage.receiver_id == c.id),
                and_(StaffMessage.sender_id == c.id, StaffMessage.receiver_id == user.id),
            )
        ).order_by(StaffMessage.created_at.desc()).first()

        unread_count = StaffMessage.query.filter_by(
            sender_id=c.id, receiver_id=user.id, is_read=False
        ).count()

        result.append({
            'id': c.id,
            'name': c.name,
            'role': c.role.name if c.role else None,
            'profile_image': c.profile_image,
            'last_message': (last_msg.body[:120] if last_msg else None),
            'last_message_at': (last_msg.created_at.isoformat() if last_msg and last_msg.created_at else None),
            'unread_count': unread_count,
        })

    # Ordenar: los que tienen mensajes más recientes primero
    result.sort(key=lambda x: (x['last_message_at'] or ''), reverse=True)
    return jsonify(result), 200


@chat_bp.route('/staff/messages/<string:contact_id>', methods=['GET'])
@jwt_required()
def get_staff_messages(contact_id):
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    role_name = _role_name(user)
    if _is_apprentice(role_name):
        return jsonify({'error': 'Acceso denegado.'}), 403

    contact = User.query.get(contact_id)
    if not contact:
        return jsonify({'error': 'Contacto no encontrado.'}), 404

    contact_role = _role_name(contact)
    if _is_apprentice(contact_role):
        return jsonify({'error': 'No se puede chatear con aprendices por este canal.'}), 403

    messages = StaffMessage.query.filter(
        or_(
            and_(StaffMessage.sender_id == user.id, StaffMessage.receiver_id == contact_id),
            and_(StaffMessage.sender_id == contact_id, StaffMessage.receiver_id == user.id),
        )
    ).order_by(StaffMessage.created_at.asc()).all()

    # Marcar como leídos los mensajes entrantes
    unread = [m for m in messages if not m.is_read and m.sender_id == contact_id]
    for m in unread:
        m.is_read = True
    if unread:
        db.session.commit()

    return jsonify({
        'contact': {
            'id': contact.id,
            'name': contact.name,
            'role': contact.role.name if contact.role else None,
            'profile_image': contact.profile_image,
        },
        'messages': [_serialize_message(m, user.id) for m in messages],
    }), 200


@chat_bp.route('/staff/messages/<string:contact_id>', methods=['POST'])
@jwt_required()
def post_staff_message(contact_id):
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    role_name = _role_name(user)
    if _is_apprentice(role_name):
        return jsonify({'error': 'Acceso denegado.'}), 403

    contact = User.query.get(contact_id)
    if not contact:
        return jsonify({'error': 'Contacto no encontrado.'}), 404

    contact_role = _role_name(contact)
    if _is_apprentice(contact_role):
        return jsonify({'error': 'No se puede chatear con aprendices por este canal.'}), 403

    data = request.get_json() or {}
    body = (data.get('body') or '').strip()
    if not body:
        return jsonify({'error': 'El mensaje no puede estar vacío.'}), 400
    if len(body) > 4000:
        return jsonify({'error': 'El mensaje excede el largo permitido (4000 caracteres).'}), 400

    msg = StaffMessage(sender_id=user.id, receiver_id=contact_id, body=body)
    db.session.add(msg)
    db.session.commit()

    return jsonify(_serialize_message(msg, user.id)), 201


# ─── ESCALACIÓN DESDE EL ASISTENTE ───────────────────────────────────────────
@chat_bp.route('/escalate', methods=['POST'])
@jwt_required()
def escalate_to_support():
    """
    Crea un ticket a partir de una conversación con la IA donde el aprendiz
    aceptó la sugerencia de hablar con Soporte.
    """
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    data = request.get_json() or {}
    user_query = (data.get('user_query') or '').strip()
    ai_response = (data.get('ai_response') or '').strip()
    extra_context = (data.get('extra_context') or '').strip()
    source_thread_id = (data.get('thread_id') or '').strip() or None

    if not user_query:
        return jsonify({'error': 'No hay contexto suficiente para crear el ticket.'}), 400

    subject = user_query[:160] if len(user_query) <= 160 else user_query[:157] + '...'

    description_parts = [
        '**Pregunta del aprendiz:**',
        user_query,
    ]
    if ai_response:
        description_parts += ['', '**Respuesta de la IA (sin éxito):**', ai_response]
    if extra_context:
        description_parts += ['', '**Contexto adicional:**', extra_context]
    description = '\n'.join(description_parts)

    ticket = Ticket(
        user_id=user.id,
        subject=subject,
        description=description,
        severity='MEDIUM',
        status='OPEN',
        source_thread_id=source_thread_id,
    )
    db.session.add(ticket)
    db.session.commit()

    # Primer mensaje del aprendiz en el chat (su pregunta original)
    first_msg = TicketMessage(
        ticket_id=ticket.id,
        sender_id=user.id,
        body=user_query,
    )
    db.session.add(first_msg)
    db.session.commit()

    return jsonify({
        'message': 'Tu solicitud fue enviada a Soporte. Pronto te responderán por este chat.',
        'ticket_id': ticket.id,
    }), 201


@chat_bp.route('/tickets/<int:ticket_id>/accept', methods=['POST'])
@jwt_required()
def accept_ticket(ticket_id):
    """Soporte o Admin acepta explícitamente un ticket (lo toma y pone IN_PROGRESS)."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'Usuario no encontrado'}), 404

    role_name = _role_name(user)
    if not _is_support(role_name):
        return jsonify({'error': 'Solo el personal de Soporte puede aceptar solicitudes.'}), 403

    ticket = Ticket.query.filter_by(id=ticket_id, is_deleted=False).first()
    if not ticket:
        return jsonify({'error': 'Ticket no encontrado'}), 404

    if ticket.status not in ('OPEN',):
        return jsonify({'error': 'Este ticket ya fue tomado o está cerrado.'}), 400

    ticket.assigned_to = user.id
    ticket.status = 'IN_PROGRESS'
    db.session.commit()

    return jsonify({
        'message': 'Solicitud aceptada. Ahora estás atendiendo a este usuario.',
        'ticket_id': ticket.id,
        'assigned_to': user.id,
        'assigned_name': user.name,
    }), 200


@chat_bp.route('/tickets/active', methods=['GET'])
@jwt_required(optional=True)
def get_active_ticket():
    """Devuelve el ticket IN_PROGRESS del usuario actual, si existe.
    Usado por el Asistente Personal para saber si hay un humano atendiendo."""
    user_id = get_jwt_identity()
    if not user_id:
        return jsonify({'active_ticket': None}), 200

    ticket = Ticket.query.filter_by(
        user_id=user_id,
        status='IN_PROGRESS',
        is_deleted=False,
    ).order_by(Ticket.created_at.desc()).first()

    if not ticket:
        return jsonify({'active_ticket': None}), 200

    assignee = User.query.get(ticket.assigned_to) if ticket.assigned_to else None
    return jsonify({
        'active_ticket': {
            'id': ticket.id,
            'subject': ticket.subject,
            'assigned_to': ticket.assigned_to,
            'assigned_name': assignee.name if assignee else 'Soporte',
            'source_thread_id': ticket.source_thread_id,
        }
    }), 200
