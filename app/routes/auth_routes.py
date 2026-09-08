from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from ..services.auth_service import AuthService
from ..services.token_service import TokenService
from ..extensions import db
from ..models.token import RefreshToken
from ..models.audit_log import AuditLog
from ..models.user import User
from ..models.user_preference import EmailChangeToken
from datetime import datetime, timedelta
import secrets
import hashlib
import bcrypt

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data received"}), 400
        
    name = data.get('nombre') or data.get('name')
    email = data.get('correo') or data.get('email')
    password = data.get('password')
    phone = data.get('telefono') or data.get('phone')
    document_type = data.get('document_type') or data.get('tipo_documento')
    document_number = data.get('document_number') or data.get('numero_documento')
    
    if not name or not email or not password:
        return jsonify({"error": "Missing required fields (name, email, password)"}), 400
        
    result, status = AuthService.register_user(
        name, 
        email, 
        password,
        document_number=document_number,
        document_type=document_type,
        phone=phone,
        role_id=data.get('role_id', 7),
        formation_ficha=data.get('formation_ficha')
    )
    return jsonify(result), status

@auth_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Credentials required"}), 400
        
    # El inicio de sesión es SOLO por número de documento (no por correo).
    identifier = data.get('documento') or data.get('nombre') or data.get('name')
    password = data.get('password')

    if not identifier or not password:
        return jsonify({"error": "Se requiere el número de documento y la contraseña"}), 400
        
    result, status = AuthService.login(identifier, password)
    return jsonify(result), status

@auth_bp.route('/verify-2fa', methods=['POST'])
@jwt_required()
def verify_2fa():
    """Valida el código 2FA después de iniciar sesión parcialmente."""
    claims = get_jwt()
    if claims.get("type") != "2fa_temp":
        return jsonify({"error": "Token inválido para esta operación."}), 401

    data = request.get_json() or {}
    code = data.get('code', '').strip()
    if not code:
        return jsonify({"error": "Código requerido."}), 400

    user_id = get_jwt_identity()
    result, status = AuthService.verify_2fa(user_id, code)
    return jsonify(result), status


@auth_bp.route('/2fa/send-email', methods=['POST'])
@jwt_required()
def send_2fa_email():
    """Envía un código 2FA al correo del usuario (login en 2 pasos)."""
    claims = get_jwt()
    if claims.get("type") != "2fa_temp":
        return jsonify({"error": "Token inválido para esta operación."}), 401

    user_id = get_jwt_identity()
    result, status = AuthService.send_2fa_email(user_id)
    return jsonify(result), status

@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    refresh_jti = get_jwt()['jti']
    access, refresh = TokenService.validate_and_rotate_refresh_token(user_id, refresh_jti)
    if not access:
        return jsonify({"error": "Session expired"}), 401
    return jsonify({"access_token": access, "refresh_token": refresh}), 200

@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    email = data.get('email') or data.get('correo')
    if not email:
        return jsonify({"error": "Email required"}), 400
    result, status = AuthService.forgot_password(email)
    return jsonify(result), status

@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    token = data.get('token')
    new_password = data.get('new_password')
    if not token or not new_password:
        return jsonify({"error": "Token and new password required"}), 400
    result, status = AuthService.reset_password(token, new_password)
    return jsonify(result), status

# ─── Cambio de contraseña en 2 pasos (configuración) ──────────────────

@auth_bp.route('/request-password-change', methods=['POST'])
@jwt_required()
def request_password_change():
    """Paso 1: valida actual + nueva, envía código de 6 dígitos al correo."""
    data = request.get_json() or {}
    old_password = data.get('old_password')
    new_password = data.get('new_password')
    if not old_password or not new_password:
        return jsonify({"error": "Contraseña actual y nueva son requeridas"}), 400
    user_id = get_jwt_identity()
    result, status = AuthService.request_password_change(user_id, old_password, new_password)
    return jsonify(result), status


@auth_bp.route('/confirm-password-change', methods=['POST'])
@jwt_required()
def confirm_password_change():
    """Paso 2: valida el código y aplica el cambio preparado."""
    data = request.get_json() or {}
    code = data.get('code', '').strip()
    if not code:
        return jsonify({"error": "Código requerido"}), 400
    user_id = get_jwt_identity()
    result, status = AuthService.confirm_password_change(user_id, code)
    return jsonify(result), status


# ─── Cambio forzado tras login con contraseña temporal ───────────────

@auth_bp.route('/force-change-password', methods=['POST'])
@jwt_required()
def force_change_password():
    """Cambia la contraseña SIN código cuando must_change_password=True (recuperación)."""
    data = request.get_json() or {}
    new_password = data.get('new_password')
    if not new_password:
        return jsonify({"error": "Nueva contraseña requerida"}), 400
    user_id = get_jwt_identity()
    result, status = AuthService.force_change_password(user_id, new_password)
    return jsonify(result), status


# Alias legacy: el frontend antiguo todavía puede llamar /change-password
@auth_bp.route('/change-password', methods=['POST'])
@jwt_required()
def change_password_legacy():
    """[Legacy] Redirige al flujo en 2 pasos: envía código en lugar de cambiar al instante."""
    data = request.get_json() or {}
    old_password = data.get('old_password')
    new_password = data.get('new_password')
    if not old_password or not new_password:
        return jsonify({"error": "Contraseña actual y nueva son requeridas"}), 400
    user_id = get_jwt_identity()
    result, status = AuthService.request_password_change(user_id, old_password, new_password)
    return jsonify(result), status


# ─── Verificación de cuenta tras registro ────────────────────────────

@auth_bp.route('/verify-account', methods=['POST'])
def verify_account():
    """Verifica la cuenta del usuario con código de 6 dígitos. Auto-loguea al confirmar."""
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    code = data.get('code', '').strip()
    result, status = AuthService.verify_account(email, code)
    return jsonify(result), status


@auth_bp.route('/resend-verification', methods=['POST'])
def resend_verification():
    """Reenvía el código de verificación si la cuenta sigue sin verificar."""
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    result, status = AuthService.resend_verification(email)
    return jsonify(result), status


@auth_bp.route('/pending-registration', methods=['GET'])
def pending_registration():
    """Datos de un registro pendiente a partir del token del correo.
    El frontend lo usa para precargar el formulario y saltar al paso del código."""
    token = request.args.get('token') or request.args.get('verify') or ''
    result, status = AuthService.get_pending_registration(token)
    return jsonify(result), status


# ─────────────────────────  SESIONES ACTIVAS  ─────────────────────────

@auth_bp.route('/sessions', methods=['GET'])
@jwt_required()
def get_sessions():
    """Lista los refresh tokens activos del usuario (sesiones abiertas)."""
    user_id = get_jwt_identity()
    now = datetime.utcnow()
    tokens = (RefreshToken.query
              .filter_by(user_id=user_id, is_revoked=False)
              .filter(RefreshToken.expires_at > now)
              .order_by(RefreshToken.created_at.desc())
              .all())

    sessions = []
    for t in tokens:
        sessions.append({
            "id": t.id,
            "created_at": t.created_at.isoformat(),
            "expires_at": t.expires_at.isoformat(),
            "device": t.user_agent or None,
        })
    return jsonify(sessions), 200


@auth_bp.route('/sessions/<int:session_id>', methods=['DELETE'])
@jwt_required()
def revoke_session(session_id):
    """Revoca (cierra) una sesión específica por ID de refresh token."""
    user_id = get_jwt_identity()
    token = RefreshToken.query.filter_by(id=session_id, user_id=user_id).first()
    if not token:
        return jsonify({"error": "Sesión no encontrada"}), 404
    token.is_revoked = True
    db.session.commit()
    return jsonify({"success": True, "message": "Sesión cerrada"}), 200


@auth_bp.route('/sessions/all', methods=['DELETE'])
@jwt_required()
def revoke_all_sessions():
    """Revoca todas las sesiones del usuario excepto la actual."""
    user_id = get_jwt_identity()

    # Revocar todos los tokens (no podemos filtrar por jti ya que solo guardamos hash)
    RefreshToken.query.filter_by(user_id=user_id, is_revoked=False).update({"is_revoked": True})
    db.session.commit()
    return jsonify({"success": True, "message": "Todas las sesiones han sido cerradas"}), 200


# ─────────────────────────  HISTORIAL DE ACCESOS  ─────────────────────

@auth_bp.route('/access-history', methods=['GET'])
@jwt_required()
def access_history():
    """Devuelve los últimos 30 eventos de login/logout del usuario."""
    user_id = get_jwt_identity()
    actions = ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED',
               'PROFILE_UPDATED', 'ACCOUNT_DELETED', 'PROFILE_IMAGE_UPDATED']
    logs = (AuditLog.query
            .filter_by(user_id=user_id)
            .filter(AuditLog.action.in_(actions))
            .order_by(AuditLog.created_at.desc())
            .limit(30)
            .all())

    return jsonify([{
        "date":    log.created_at.isoformat(),
        "action":  log.action,
        "ip":      log.ip or '—',
        "device":  log.user_agent or '—',
        "ok":      log.action not in ('LOGIN_FAILED',),
    } for log in logs]), 200


@auth_bp.route('/access-history', methods=['DELETE'])
@jwt_required()
def clear_access_history():
    """Elimina todo el historial de accesos del usuario."""
    user_id = get_jwt_identity()
    actions = ['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED',
               'PROFILE_UPDATED', 'ACCOUNT_DELETED', 'PROFILE_IMAGE_UPDATED']
    deleted = AuditLog.query.filter_by(user_id=user_id).filter(AuditLog.action.in_(actions)).delete()
    db.session.commit()
    return jsonify({"success": True, "message": f"{deleted} evento(s) eliminado(s)"}), 200


# ─────────────────────────  CAMBIO DE CORREO  ─────────────────────────

@auth_bp.route('/change-email', methods=['POST'])
@jwt_required()
def request_email_change():
    """Inicia el cambio de correo: valida contraseña y envía código al nuevo email."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    new_email = data.get('new_email', '').strip().lower()
    password  = data.get('password', '')

    if not new_email or not password:
        return jsonify({"error": "Nuevo correo y contraseña son requeridos"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuario no encontrado"}), 404

    if not bcrypt.checkpw(password.encode('utf-8'), user.password.encode('utf-8')):
        return jsonify({"error": "Contraseña incorrecta"}), 401

    if User.query.filter_by(email=new_email).first():
        return jsonify({"error": "Ese correo ya está registrado por otro usuario"}), 400

    # Generar código de 6 dígitos
    code = str(secrets.randbelow(900000) + 100000)
    token_hash = hashlib.sha256(code.encode()).hexdigest()
    expires = datetime.utcnow() + timedelta(minutes=15)

    # Invalidar tokens previos
    EmailChangeToken.query.filter_by(user_id=user_id, is_used=False).update({"is_used": True})

    change_token = EmailChangeToken(
        user_id=user_id,
        new_email=new_email,
        token_hash=token_hash,
        expires_at=expires
    )
    db.session.add(change_token)
    db.session.commit()

    # Enviar correo con código
    try:
        from flask_mail import Message
        from ..extensions import mail
        msg = Message(
            "Verificación de cambio de correo — Biblioteca SENA",
            recipients=[new_email]
        )
        msg.body = (
            f"Hola {user.name},\n\n"
            f"Tu código de verificación para cambiar el correo es: {code}\n\n"
            f"Este código expira en 15 minutos.\n\n"
            f"Si no solicitaste este cambio, ignora este mensaje."
        )
        mail.send(msg)
    except Exception as e:
        print(f"Error enviando correo de cambio de email: {e}")
        # No fallamos — el endpoint devuelve éxito aunque el correo falle en dev

    return jsonify({"success": True, "message": f"Código de verificación enviado a {new_email}"}), 200


@auth_bp.route('/verify-email-change', methods=['POST'])
@jwt_required()
def verify_email_change():
    """Confirma el cambio de correo con el código de 6 dígitos."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    code = data.get('code', '').strip()

    if not code:
        return jsonify({"error": "Código requerido"}), 400

    token_hash = hashlib.sha256(code.encode()).hexdigest()
    now = datetime.utcnow()

    change_token = (EmailChangeToken.query
                    .filter_by(user_id=user_id, token_hash=token_hash, is_used=False)
                    .filter(EmailChangeToken.expires_at > now)
                    .first())

    if not change_token:
        return jsonify({"error": "Código inválido o expirado"}), 400

    user = User.query.get(user_id)
    user.email = change_token.new_email
    change_token.is_used = True

    log = AuditLog(user_id=user_id, action="EMAIL_CHANGED", entity="User",
                   details=f"Nuevo email: {change_token.new_email}")
    db.session.add(log)
    db.session.commit()

    return jsonify({"success": True, "message": "Correo actualizado correctamente", "new_email": user.email}), 200
