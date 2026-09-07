from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..extensions import db
from ..models.user import User, Role
from ..models.movement import Notification
from ..models.loan import Loan
from ..models.reservation import Reservation
from ..models.audit_log import AuditLog
from ..models.user_preference import UserPreference
from sqlalchemy import func, or_, String
import bcrypt

user_bp = Blueprint('users_mgmt', __name__)


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

@user_bp.route('/', methods=['GET'])
@jwt_required()
def get_users():
    search = request.args.get('search', '')
    query = User.query.filter_by(is_deleted=False)
    
    if search:
        search_filter = f"%{search}%"
        query = query.outerjoin(Role, User.role_id == Role.id).filter(
            or_(
                User.id.ilike(search_filter),
                User.name.ilike(search_filter),
                User.email.ilike(search_filter),
                User.phone.ilike(search_filter),
                Role.name.ilike(search_filter)
            )
        )
        
    users = query.all()
    result = []
    for user in users:
        result.append({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "phone": user.phone,
            "role": user.role.name if user.role else "N/A",
            "is_active": user.is_active,
            "is_blocked": user.is_blocked,
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "failed_attempts": user.failed_attempts,
            "created_at": user.created_at.isoformat(),
            "profile_image": _full_media_url(user.profile_image),
            "dependency_id": user.dependency_id,
            "dependency_name": user.dependency_obj.name if user.dependency_obj else None
        })
    return jsonify(result), 200

@user_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_user_stats():
    total = User.query.filter_by(is_deleted=False).count()
    active = User.query.filter_by(is_deleted=False, is_active=True).count()
    inactive = User.query.filter_by(is_deleted=False, is_active=False).count()
    blocked = User.query.filter_by(is_deleted=False, is_blocked=True).count()
    
    # Por rol
    roles_count = db.session.query(Role.name, func.count(User.id)).join(User).group_by(Role.id).all()
    by_role = {r[0]: r[1] for r in roles_count}
    
    return jsonify({
        "total": total,
        "active": active,
        "inactive": inactive,
        "blocked": blocked,
        "by_role": by_role
    }), 200

@user_bp.route('/<string:id>/toggle-active', methods=['POST'])
@jwt_required()
def toggle_user_active(id):
    user = User.query.get_or_404(id)
    user.is_active = not user.is_active
    
    action = "USER_DEACTIVATED" if not user.is_active else "USER_REACTIVATED"
    log = AuditLog(user_id=get_jwt_identity(), action=action, entity_id=id, entity="User")
    db.session.add(log)
    db.session.commit()
    
    return jsonify({"success": True, "is_active": user.is_active}), 200

@user_bp.route('/<string:id>/unblock', methods=['POST'])
@jwt_required()
def unblock_user(id):
    user = User.query.get_or_404(id)
    user.is_blocked = False
    user.failed_attempts = 0
    
    log = AuditLog(user_id=get_jwt_identity(), action="USER_UNBLOCKED", entity_id=id, entity="User")
    db.session.add(log)
    db.session.commit()
    
    return jsonify({"success": True}), 200

@user_bp.route('/<string:id>/change-role', methods=['POST'])
@jwt_required()
def change_user_role(id):
    data = request.get_json()
    new_role_name = data.get('role')
    
    user = User.query.get_or_404(id)
    role = Role.query.filter_by(name=new_role_name).first()
    if not role:
        return jsonify({"error": "Rol no válido"}), 400
        
    user.role_id = role.id
    log = AuditLog(user_id=get_jwt_identity(), action="ROLE_CHANGED", entity_id=id, entity="User", details=f"New role: {new_role_name}")
    db.session.add(log)
    db.session.commit()
    
    return jsonify({"success": True}), 200

@user_bp.route('/<string:id>/detail', methods=['GET'])
@jwt_required()
def get_user_detail(id):
    user = User.query.get_or_404(id)
    
    # Préstamos activos
    active_loans = Loan.query.filter_by(user_id=id, status='ACTIVE').count()
    
    # Reservas activas (QUEUED o READY)
    active_res = Reservation.query.filter_by(user_id=id).filter(Reservation.status.in_(['QUEUED', 'READY'])).count()
    
    # Últimos 10 logs de auditoría del usuario
    logs = AuditLog.query.filter_by(user_id=id).order_by(AuditLog.created_at.desc()).limit(10).all()
    
    return jsonify({
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone,
        "role": user.role.name if user.role else "N/A",
        "active_loans": active_loans,
        "active_reservations": active_res,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "audit_logs": [{
            "action": l.action,
            "date": l.created_at.isoformat(),
            "ip": l.ip
        } for l in logs]
    }), 200
@user_bp.route('/', methods=['POST'])
@jwt_required()
def create_user():
    data = request.get_json()
    
    # Validar si el usuario ya existe
    if User.query.get(data.get('id')):
        return jsonify({"error": "El documento ya está registrado"}), 400
    
    if User.query.filter_by(email=data.get('email')).first():
        return jsonify({"error": "El email ya está registrado"}), 400

    role = Role.query.filter_by(name=data.get('role')).first()
    if not role:
        return jsonify({"error": "Rol no válido"}), 400

    # Hash password
    password = data.get('password', data.get('id')) # Default password is ID if not provided
    hashed_pw = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    new_user = User(
        id=data.get('id'),
        document_type=data.get('document_type', 'CC'),
        name=data.get('name'),
        email=data.get('email'),
        phone=data.get('phone'),
        password=hashed_pw,
        role_id=role.id,
        dependency_id=data.get('dependency_id'), # Nuevo: Asignar dependencia
        formation_ficha=data.get('formation_ficha'),
        created_by=get_jwt_identity()
    )

    db.session.add(new_user)
    
    # Audit Log
    log = AuditLog(
        user_id=get_jwt_identity(),
        action="USER_CREATED",
        entity_id=None,
        entity="User",
        details=f"Created user {new_user.name} with role {role.name}"
    )
    db.session.add(log)
    db.session.commit()

    admin_role = Role.query.filter_by(name='ADMIN').first()
    if admin_role:
        admin_users = User.query.filter(
            User.role_id == admin_role.id,
            User.is_deleted == False,
            User.is_active == True,
            User.id != get_jwt_identity(),
        ).all()
        for admin in admin_users:
            db.session.add(Notification(
                user_id=str(admin.id),
                type='USER_CREATED',
                title='Nuevo usuario registrado',
                message=f'Se creó el usuario {new_user.name} con rol {role.name}.',
                related_type='user',
            ))
    db.session.commit()

    return jsonify({"success": True, "message": "Usuario creado exitosamente"}), 201

@user_bp.route('/roles', methods=['GET'])
@jwt_required()
def get_roles():
    roles = Role.query.all()
    return jsonify([r.name for r in roles]), 200

# ─────────────────────────  PERFIL PROPIO  ─────────────────────────

@user_bp.route('/me', methods=['GET'])
@jwt_required()
def get_me():
    """Devuelve el perfil completo del usuario autenticado."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    return jsonify({
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "phone": user.phone or '',
        "document_type": user.document_type,
        "formation_ficha": user.formation_ficha or '',
        "role": user.role.name if user.role else None,
        "profile_image": _full_media_url(user.profile_image),
        "biography": user.biography or '',
        "is_active": user.is_active,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }), 200


@user_bp.route('/me', methods=['PATCH'])
@jwt_required()
def update_me():
    """Actualiza los datos personales del usuario autenticado."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    data = request.get_json() or {}
    changed = []

    name_val = (data.get('name') or '').strip()
    if 'name' in data and name_val:
        user.name = name_val
        changed.append('name')

    if 'phone' in data:
        user.phone = (data.get('phone') or '').strip() or None
        changed.append('phone')

    doc_val = (data.get('document_type') or '').strip()
    if 'document_type' in data and doc_val:
        user.document_type = doc_val
        changed.append('document_type')

    if 'formation_ficha' in data:
        user.formation_ficha = (data.get('formation_ficha') or '').strip() or None
        changed.append('formation_ficha')

    if 'biography' in data:
        user.biography = (data.get('biography') or '').strip() or None
        changed.append('biography')

    if changed:
        log = AuditLog(user_id=user_id, action="PROFILE_UPDATED",
                       entity="User", details=f"Campos: {', '.join(changed)}")
        db.session.add(log)
        db.session.commit()

    return jsonify({"success": True, "message": "Perfil actualizado"}), 200


@user_bp.route('/me/preferences', methods=['GET'])
@jwt_required()
def get_preferences():
    """Devuelve las preferencias de notificaciones y privacidad."""
    user_id = get_jwt_identity()
    pref = UserPreference.query.filter_by(user_id=user_id).first()
    if not pref:
        # Crear con valores por defecto
        pref = UserPreference(user_id=user_id)
        db.session.add(pref)
        db.session.commit()

    return jsonify({
        "notifications": {
            "loanReminder":     pref.notif_loan_reminder,
            "loanOverdue":      pref.notif_loan_overdue,
            "reservationReady": pref.notif_reservation,
            "newCatalogItems":  pref.notif_new_items,
            "weeklySummary":    pref.notif_weekly_summary,
            "promotions":       pref.notif_promotions,
        },
        "channels": {
            "email":  pref.channel_email,
            "inapp":  pref.channel_inapp,
            "sms":    pref.channel_sms,
        },
        "alerts": {
            "reminderDays": pref.alert_reminder_days,
            "quietStart":   pref.quiet_start,
            "quietEnd":     pref.quiet_end,
        },
        "privacy": {
            "profileVisible": pref.privacy_profile_visible,
            "showActivity":   pref.privacy_show_activity,
            "analytics":      pref.privacy_analytics,
        }
    }), 200


@user_bp.route('/me/preferences', methods=['PATCH'])
@jwt_required()
def update_preferences():
    """Guarda preferencias de notificaciones/alertas/privacidad."""
    user_id = get_jwt_identity()
    pref = UserPreference.query.filter_by(user_id=user_id).first()
    if not pref:
        pref = UserPreference(user_id=user_id)
        db.session.add(pref)

    data = request.get_json() or {}

    notif = data.get('notifications', {})
    if 'loanReminder'     in notif: pref.notif_loan_reminder  = bool(notif['loanReminder'])
    if 'loanOverdue'      in notif: pref.notif_loan_overdue   = bool(notif['loanOverdue'])
    if 'reservationReady' in notif: pref.notif_reservation    = bool(notif['reservationReady'])
    if 'newCatalogItems'  in notif: pref.notif_new_items      = bool(notif['newCatalogItems'])
    if 'weeklySummary'    in notif: pref.notif_weekly_summary = bool(notif['weeklySummary'])
    if 'promotions'       in notif: pref.notif_promotions     = bool(notif['promotions'])

    channels = data.get('channels', {})
    if 'email' in channels: pref.channel_email = bool(channels['email'])
    if 'inapp' in channels: pref.channel_inapp = bool(channels['inapp'])
    if 'sms'   in channels: pref.channel_sms   = bool(channels['sms'])

    alerts = data.get('alerts', {})
    if 'reminderDays' in alerts: pref.alert_reminder_days = int(alerts['reminderDays'])
    if 'quietStart'   in alerts: pref.quiet_start = alerts['quietStart']
    if 'quietEnd'     in alerts: pref.quiet_end   = alerts['quietEnd']

    privacy = data.get('privacy', {})
    if 'profileVisible' in privacy: pref.privacy_profile_visible = bool(privacy['profileVisible'])
    if 'showActivity'   in privacy: pref.privacy_show_activity   = bool(privacy['showActivity'])
    if 'analytics'      in privacy: pref.privacy_analytics       = bool(privacy['analytics'])

    db.session.commit()
    return jsonify({"success": True, "message": "Preferencias guardadas"}), 200


@user_bp.route('/me/export-data', methods=['GET'])
@jwt_required()
def export_my_data():
    """Exporta todos los datos del usuario en formato JSON."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    loans = Loan.query.filter_by(user_id=user_id).all()
    reservations = Reservation.query.filter_by(user_id=user_id).all()
    logs = AuditLog.query.filter_by(user_id=user_id).order_by(AuditLog.created_at.desc()).limit(50).all()

    export = {
        "perfil": {
            "id": user.id,
            "nombre": user.name,
            "correo": user.email,
            "telefono": user.phone,
            "tipo_documento": user.document_type,
            "ficha_formacion": user.formation_ficha,
            "biografia": user.biography or '',
            "rol": user.role.name if user.role else None,
            "cuenta_creada": user.created_at.isoformat() if user.created_at else None,
            "ultimo_acceso": user.last_login.isoformat() if user.last_login else None,
        },
        "prestamos": [
            {
                "id": l.id,
                "estado": l.status,
                "fecha_prestamo": l.loan_date.isoformat() if l.loan_date else None,
                "fecha_devolucion": l.return_date.isoformat() if l.return_date else None,
            } for l in loans
        ],
        "reservas": [
            {
                "id": r.id,
                "estado": r.status,
                "fecha_creacion": r.created_at.isoformat() if r.created_at else None,
            } for r in reservations
        ],
        "historial_accesos": [
            {
                "accion": lg.action,
                "fecha": lg.created_at.isoformat(),
                "ip": lg.ip,
                "dispositivo": lg.user_agent,
            } for lg in logs
        ]
    }
    return jsonify(export), 200


@user_bp.route('/me/export-pdf', methods=['GET'])
@jwt_required()
def export_my_data_pdf():
    """Exporta los datos del usuario como página HTML estilizada para imprimir/PDF."""
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    loans = Loan.query.filter_by(user_id=user_id).all()
    reservations = Reservation.query.filter_by(user_id=user_id).all()
    logs = AuditLog.query.filter_by(user_id=user_id).order_by(AuditLog.created_at.desc()).limit(30).all()

    fmt = lambda d: d.strftime('%d/%m/%Y %H:%M') if d else '—'

    rows_loans = ''
    for l in loans:
        rows_loans += f'''<tr>
            <td>{l.id}</td>
            <td>{l.status}</td>
            <td>{fmt(l.loan_date)}</td>
            <td>{fmt(l.return_date)}</td>
        </tr>'''

    rows_reservations = ''
    for r in reservations:
        rows_reservations += f'''<tr>
            <td>{r.id}</td>
            <td>{r.status}</td>
            <td>{fmt(r.created_at)}</td>
        </tr>'''

    rows_logs = ''
    for lg in logs:
        rows_logs += f'''<tr>
            <td>{lg.action}</td>
            <td>{fmt(lg.created_at)}</td>
            <td>{lg.ip or '—'}</td>
        </tr>'''

    table_loans = f'''<table>
            <thead><tr><th>ID</th><th>Estado</th><th>Fecha Préstamo</th><th>Devolución</th></tr></thead>
            <tbody>{rows_loans}</tbody>
        </table>''' if loans else "<p>No hay préstamos registrados.</p>"

    table_reservations = f'''<table>
            <thead><tr><th>ID</th><th>Estado</th><th>Fecha Creación</th></tr></thead>
            <tbody>{rows_reservations}</tbody>
        </table>''' if reservations else "<p>No hay reservas registradas.</p>"

    table_logs = f'''<table>
            <thead><tr><th>Acción</th><th>Fecha</th><th>IP</th></tr></thead>
            <tbody>{rows_logs}</tbody>
        </table>''' if logs else "<p>No hay accesos registrados.</p>"

    html = f'''<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Mis Datos - Biblioteca SENA</title>
<style>
    @page {{ margin: 2cm; size: A4; }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; background: #fff; padding: 2rem; line-height: 1.5; }}
    .header {{ text-align: center; border-bottom: 3px solid #39A900; padding-bottom: 1rem; margin-bottom: 2rem; }}
    .header h1 {{ color: #39A900; font-size: 1.6rem; }}
    .header p {{ color: #64748b; font-size: 0.85rem; }}
    .section {{ margin-bottom: 2rem; }}
    .section h2 {{ background: #f0fdf4; color: #166534; padding: 0.6rem 1rem; border-radius: 6px; font-size: 1.1rem; margin-bottom: 1rem; border-left: 4px solid #39A900; }}
    .info-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 2rem; padding: 0 0.5rem; }}
    .info-grid .label {{ font-weight: 600; color: #475569; }}
    .info-grid .value {{ color: #0f172a; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.82rem; }}
    th {{ background: #39A900; color: #fff; padding: 0.5rem 0.6rem; text-align: left; font-weight: 600; }}
    td {{ padding: 0.4rem 0.6rem; border-bottom: 1px solid #e2e8f0; }}
    tr:nth-child(even) {{ background: #f8fafc; }}
    .footer {{ text-align: center; color: #94a3b8; font-size: 0.75rem; margin-top: 3rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; }}
    .badge {{ display: inline-block; padding: 0.15rem 0.5rem; border-radius: 10px; font-size: 0.75rem; font-weight: 600; }}
    .badge-green {{ background: #dcfce7; color: #166534; }}
    .badge-yellow {{ background: #fef9c3; color: #854d0e; }}
    .badge-red {{ background: #fee2e2; color: #991b1b; }}
    @media print {{ body {{ padding: 0; }} .no-print {{ display: none; }} }}
</style>
</head>
<body>
<div class="header">
    <h1>Biblioteca SENA — Mis Datos Personales</h1>
    <p>Generado el {datetime.now().strftime('%d/%m/%Y a las %H:%M')}</p>
</div>

<div class="section">
    <h2>Información del Perfil</h2>
    <div class="info-grid">
        <span class="label">Nombre:</span><span class="value">{user.name or '—'}</span>
        <span class="label">Correo:</span><span class="value">{user.email or '—'}</span>
        <span class="label">Teléfono:</span><span class="value">{user.phone or '—'}</span>
        <span class="label">Tipo Documento:</span><span class="value">{user.document_type or '—'}</span>
        <span class="label">Rol:</span><span class="value">{user.role.name if user.role else '—'}</span>
        <span class="label">Cuenta creada:</span><span class="value">{fmt(user.created_at)}</span>
        <span class="label">Último acceso:</span><span class="value">{fmt(user.last_login)}</span>
    </div>
</div>

    <div class="section">
        <h2>Préstamos ({len(loans)})</h2>
        {table_loans}
    </div>

    <div class="section">
        <h2>Reservas ({len(reservations)})</h2>
        {table_reservations}
    </div>

    <div class="section">
        <h2>Historial de Accesos ({len(logs)})</h2>
        {table_logs}
    </div>

<div class="footer">
    <p>Biblioteca SENA — Sistema de Gestión | Datos exportados por el usuario</p>
</div>
</body>
</html>'''

    return html, 200, {'Content-Type': 'text/html; charset=utf-8'}


@user_bp.route('/me', methods=['DELETE'])
@jwt_required()
def delete_my_account():
    """Elimina (soft delete) la cuenta del usuario autenticado."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    password = data.get('password', '')

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    if not bcrypt.checkpw(password.encode('utf-8'), user.password.encode('utf-8')):
        return jsonify({"error": "Contraseña incorrecta"}), 401

    # Verificar préstamos activos
    active_loans = Loan.query.filter_by(user_id=user_id, status='ACTIVE').count()
    if active_loans > 0:
        return jsonify({"error": f"Tienes {active_loans} préstamo(s) activo(s). Debes devolverlos antes de eliminar tu cuenta."}), 400

    user.is_deleted = True
    user.is_active = False

    log = AuditLog(user_id=user_id, action="ACCOUNT_DELETED", entity="User",
                   details="Usuario eliminó su propia cuenta")
    db.session.add(log)
    db.session.commit()

    return jsonify({"success": True, "message": "Cuenta eliminada. Hasta pronto."}), 200


# ─────────────────────────  IMAGEN DE PERFIL  ─────────────────────────

@user_bp.route('/profile-image', methods=['PATCH'])
@jwt_required()
def update_profile_image():
    user_id = get_jwt_identity()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404
        
    data = request.get_json()
    image_data = data.get('profile_image')
    # Procesar imagen en Base64 y guardarla físicamente
    if image_data and image_data.startswith('data:image'):
        try:
            import os
            import base64
            from flask import current_app
            
            header, encoded = image_data.split(',', 1)
            ext = header.split(';')[0].split('/')[1]
            if ext == 'jpeg': ext = 'jpg'
            
            filename = f"profile_{user.id}.{ext}"
            filepath = os.path.join(current_app.root_path, 'uploads', filename)

            with open(filepath, "wb") as fh:
                fh.write(base64.b64decode(encoded))

            # Guardar ruta RELATIVA (el proxy de Vite / nginx resuelve /uploads)
            user.profile_image = f"/uploads/{filename}"
        except Exception as e:
            print("Error guardando foto de perfil:", e)
    else:
        # Ruta /uploads o URL externa: se guarda tal cual (se normaliza al leer)
        user.profile_image = _full_media_url(image_data) if image_data else image_data
    
    log = AuditLog(user_id=user_id, action="PROFILE_IMAGE_UPDATED", entity="User")
    db.session.add(log)
    db.session.commit()
    
    return jsonify({
        "success": True, 
        "message": "Foto de perfil actualizada",
        "profile_image": user.profile_image
    }), 200
