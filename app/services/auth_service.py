import bcrypt
import re
import secrets
import string
import hashlib
import json
from typing import Optional
from datetime import datetime, timedelta
from flask import request
from sqlalchemy import or_
from ..extensions import db
from ..models.user import User, Role
from ..models.audit_log import AuditLog
from ..models.token import PasswordResetToken
from ..models.verification_code import VerificationCode
from .token_service import TokenService
from .email_service import EmailService


# ── Validadores reutilizables ─────────────────────────────────────────

EMAIL_REGEX = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
PHONE_REGEX_CO = re.compile(r"^3\d{9}$")   # Colombia: 10 dígitos comenzando en 3


def _validate_email(email: str) -> Optional[str]:
    """Devuelve un mensaje de error o None si es válido."""
    if not email or not email.strip():
        return "El correo es requerido"
    if len(email) > 120:
        return "El correo es demasiado largo"
    if not EMAIL_REGEX.match(email.strip()):
        return "Formato de correo inválido (ej: usuario@correo.com)"
    return None


def _validate_phone(phone: Optional[str]) -> Optional[str]:
    """Valida teléfono colombiano (10 dígitos, comienza en 3). None si no se envió."""
    if phone is None or phone == '':
        return None   # opcional
    cleaned = re.sub(r"[\s\-\+]", "", phone)   # quita espacios, guiones, '+'
    cleaned = re.sub(r"^57", "", cleaned)      # quita prefijo país si quedó
    if not PHONE_REGEX_CO.match(cleaned):
        return "Teléfono inválido. Debe tener 10 dígitos y comenzar en 3 (ej: 3001234567)"
    return None


def _validate_password_strength(password: str) -> Optional[str]:
    """Valida fortaleza mínima de contraseña."""
    if not password:
        return "La contraseña es requerida"
    if len(password) < 8:
        return "La contraseña debe tener al menos 8 caracteres"
    if " " in password:
        return "La contraseña no puede contener espacios"
    return None


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _generate_6digit_code() -> str:
    return f"{secrets.randbelow(900000) + 100000}"


def _generate_temp_password(length: int = 12) -> str:
    """Genera contraseña aleatoria fuerte: letras, números, un símbolo seguro."""
    alphabet = string.ascii_letters + string.digits
    # Asegurar al menos: 1 mayúscula + 1 minúscula + 1 dígito + 1 símbolo
    while True:
        pw = ''.join(secrets.choice(alphabet) for _ in range(length - 1)) + secrets.choice("!@#$%&*")
        if (any(c.isupper() for c in pw) and any(c.islower() for c in pw)
                and any(c.isdigit() for c in pw)):
            return pw


# ─────────────────────────  SERVICIO PRINCIPAL  ──────────────────────

class AuthService:

    # ── Registro ──────────────────────────────────────────────────────

    @staticmethod
    def register_user(name, email, password, document_number, document_type,
                      phone=None, role_id=None, formation_ficha=None):
        """Registra un nuevo usuario. Queda con `is_verified=False` hasta que confirme con código."""

        # 1) Validaciones
        if not name or not name.strip():
            return {"error": "El nombre es requerido"}, 400
        if not document_number or not str(document_number).strip():
            return {"error": "El número de documento es requerido"}, 400

        err = _validate_email(email)
        if err: return {"error": err}, 400

        err = _validate_phone(phone)
        if err: return {"error": err}, 400

        err = _validate_password_strength(password)
        if err: return {"error": err}, 400

        # 2) Duplicados
        existing = User.query.filter(
            or_(User.email == email.strip().lower(), User.id == str(document_number))
        ).first()
        if existing:
            if existing.is_deleted:
                return {"error": "Esta cuenta fue eliminada. Contacta al administrador."}, 400
            return {"error": "El correo o número de documento ya está registrado"}, 400

        # 3) Crear usuario
        hashed_pw = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        if not role_id:
            role = Role.query.filter_by(name='APRENDIZ').first()
            if not role:
                return {"error": "El rol APRENDIZ no existe en la base de datos"}, 500
            role_id = role.id

        final_ficha = formation_ficha.strip() if formation_ficha and formation_ficha.strip() else None

        new_user = User(
            id=str(document_number),
            document_type=document_type or 'CC',
            name=name.strip(),
            email=email.strip().lower(),
            phone=phone.strip() if phone else None,
            password=hashed_pw,
            role_id=role_id,
            formation_ficha=final_ficha,
            is_verified=False,
        )
        db.session.add(new_user)
        db.session.commit()

        # 4) Generar y enviar código de verificación
        AuthService._issue_verification_code(new_user, purpose='ACCOUNT_VERIFY', minutes=15)

        return {
            "success": True,
            "message": "Cuenta creada. Revisa tu correo y verifica con el código de 6 dígitos.",
            "requires_verification": True,
            "email": new_user.email,
        }, 201

    @staticmethod
    def verify_account(email, code):
        """Verifica una cuenta recién registrada usando el código de 6 dígitos."""
        if not email or not code:
            return {"error": "Correo y código son requeridos"}, 400

        user = User.query.filter_by(email=email.strip().lower(), is_deleted=False).first()
        if not user:
            return {"error": "Cuenta no encontrada"}, 404
        if user.is_verified:
            return {"success": True, "message": "Tu cuenta ya está verificada. Inicia sesión."}, 200

        vc = AuthService._consume_code(user.id, code, purpose='ACCOUNT_VERIFY')
        if isinstance(vc, dict):   # error
            return vc, 400

        user.is_verified = True
        db.session.commit()
        AuthService._log_audit(user.id, "ACCOUNT_VERIFIED", ip=request.remote_addr)

        # Auto-login tras verificar
        access, refresh = TokenService.generate_auth_tokens(user)
        return {
            "success": True,
            "message": "Cuenta verificada correctamente.",
            "access_token": access,
            "refresh_token": refresh,
            "user": AuthService._user_payload(user),
        }, 200

    @staticmethod
    def resend_verification(email):
        """Reenvía el código de verificación si la cuenta sigue sin verificar."""
        if not email:
            return {"error": "Correo requerido"}, 400
        user = User.query.filter_by(email=email.strip().lower(), is_deleted=False).first()
        if not user:
            return {"success": True, "message": "Si la cuenta existe, se reenvió el código."}, 200
        if user.is_verified:
            return {"success": True, "message": "Tu cuenta ya está verificada."}, 200
        AuthService._issue_verification_code(user, purpose='ACCOUNT_VERIFY', minutes=15)
        return {"success": True, "message": "Código reenviado."}, 200

    # ── Login ─────────────────────────────────────────────────────────

    @staticmethod
    def login(identifier, password):
        """Autentica con email o documento. Bloquea login si la cuenta no está verificada."""
        user = User.query.filter(
            or_(User.id == identifier, User.email == (identifier or '').strip().lower()),
            User.is_deleted == False
        ).first()

        if not user:
            return {"error": "Credenciales inválidas"}, 401

        if not user.is_active:
            return {"error": "Esta cuenta está inactiva. Contacte al administrador."}, 401

        if user.is_blocked:
            AuthService._log_audit(user.id, "LOGIN_BLOCKED_PERMANENT", ip=request.remote_addr)
            return {"error": "Cuenta bloqueada por seguridad. Contacte al administrador."}, 403

        if user.failed_attempts >= 5:
            user.is_blocked = True
            db.session.commit()
            AuthService._log_audit(user.id, "USER_BLOCKED_AUTO", ip=request.remote_addr)
            return {"error": "Cuenta bloqueada por demasiados intentos fallidos."}, 403

        if not bcrypt.checkpw(password.encode('utf-8'), user.password.encode('utf-8')):
            user.failed_attempts += 1
            user.last_failed_login = datetime.utcnow()
            db.session.commit()
            AuthService._log_audit(user.id, "LOGIN_FAILED", ip=request.remote_addr)
            return {"error": "Credenciales inválidas"}, 401

        # Cuenta no verificada
        if not user.is_verified:
            # Reemitir código y avisar
            AuthService._issue_verification_code(user, purpose='ACCOUNT_VERIFY', minutes=15)
            return {
                "error": "Debes verificar tu correo antes de iniciar sesión.",
                "requires_verification": True,
                "email": user.email,
            }, 403

        # Éxito
        user.failed_attempts = 0
        user.last_failed_login = None
        user.last_login = datetime.utcnow()
        db.session.commit()

        access, refresh = TokenService.generate_auth_tokens(user)
        AuthService._log_audit(user.id, "LOGIN_SUCCESS", ip=request.remote_addr)

        return {
            "access_token": access,
            "refresh_token": refresh,
            "must_change_password": bool(user.must_change_password),
            "user": AuthService._user_payload(user),
        }, 200

    # ── Recuperación (contraseña temporal) ───────────────────────────

    @staticmethod
    def forgot_password(email):
        """Genera contraseña temporal aleatoria, la envía por email y marca must_change_password."""
        err = _validate_email(email or '')
        if err:
            # No revelamos si el correo existe — respuesta neutra
            return {"success": True, "message": "Si la cuenta existe, recibirás una contraseña temporal."}, 200

        user = User.query.filter_by(email=email.strip().lower(), is_deleted=False).first()
        AuthService._log_audit(user.id if user else None, "PASSWORD_RESET_REQUEST", ip=request.remote_addr)

        if user:
            temp_pw = _generate_temp_password(12)
            user.password = bcrypt.hashpw(temp_pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            user.must_change_password = True
            # Reset bloqueo (la recuperación válida desbloquea)
            user.failed_attempts = 0
            user.is_blocked = False
            # Revocar todas las sesiones activas
            TokenService.revoke_all_user_tokens(user.id)
            db.session.commit()

            EmailService.send_temporary_password(user.email, temp_pw, user.name)

        # Respuesta neutra (no revelar si existe el correo)
        return {"success": True, "message": "Si la cuenta existe, recibirás una contraseña temporal en breve."}, 200

    @staticmethod
    def reset_password(token, new_password):
        """[Legacy] Reset por link/token. Se mantiene para no romper compatibilidad."""
        err = _validate_password_strength(new_password)
        if err: return {"error": err}, 400
        reset_token = PasswordResetToken.query.filter_by(token_hash=token, is_used=False).first()
        if not reset_token or reset_token.expires_at < datetime.utcnow():
            return {"error": "Token inválido o expirado"}, 400
        user = reset_token.user
        user.password = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        user.must_change_password = False
        reset_token.is_used = True
        TokenService.revoke_all_user_tokens(user.id)
        db.session.commit()
        AuthService._log_audit(user.id, "PASSWORD_RESET_SUCCESS", ip=request.remote_addr)
        return {"success": True, "message": "Contraseña actualizada correctamente"}, 200

    # ── Cambio de contraseña (autenticado, 2 pasos con código email) ─

    @staticmethod
    def request_password_change(user_id, old_password, new_password):
        """
        Paso 1: valida contraseña actual + nueva, guarda la nueva (hash) pendiente
        en VerificationCode.payload y envía código de 6 dígitos por correo.
        """
        user = User.query.filter_by(id=user_id, is_deleted=False).first()
        if not user:
            return {"error": "Usuario no encontrado"}, 404

        if not bcrypt.checkpw(old_password.encode('utf-8'), user.password.encode('utf-8')):
            AuthService._log_audit(user.id, "CHANGE_PASSWORD_FAILED", ip=request.remote_addr)
            return {"error": "La contraseña actual es incorrecta"}, 401

        err = _validate_password_strength(new_password)
        if err: return {"error": err}, 400

        if bcrypt.checkpw(new_password.encode('utf-8'), user.password.encode('utf-8')):
            return {"error": "La nueva contraseña no puede ser igual a la actual"}, 400

        # Guardar el hash de la nueva contraseña en payload del código
        new_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        payload = json.dumps({"new_password_hash": new_hash})

        AuthService._issue_verification_code(
            user, purpose='PASSWORD_CHANGE', minutes=10, payload=payload
        )

        return {
            "success": True,
            "message": "Te enviamos un código a tu correo para confirmar el cambio.",
            "requires_code": True,
            "email_masked": AuthService._mask_email(user.email),
        }, 200

    @staticmethod
    def confirm_password_change(user_id, code):
        """Paso 2: valida el código y aplica el cambio de contraseña previamente preparado."""
        user = User.query.filter_by(id=user_id, is_deleted=False).first()
        if not user:
            return {"error": "Usuario no encontrado"}, 404

        vc = AuthService._consume_code(user.id, code, purpose='PASSWORD_CHANGE')
        if isinstance(vc, dict):
            return vc, 400

        try:
            data = json.loads(vc.payload or '{}')
            new_hash = data.get('new_password_hash')
        except Exception:
            new_hash = None
        if not new_hash:
            return {"error": "Solicitud inválida. Vuelve a iniciar el cambio."}, 400

        user.password = new_hash
        user.must_change_password = False
        # Revocar todas las sesiones (excepto la actual no se puede en este flujo simple)
        TokenService.revoke_all_user_tokens(user.id)
        db.session.commit()
        AuthService._log_audit(user.id, "PASSWORD_CHANGED", ip=request.remote_addr)
        return {"success": True, "message": "Contraseña actualizada correctamente."}, 200

    @staticmethod
    def force_change_password(user_id, new_password):
        """Permite cambiar la contraseña SIN código cuando el usuario tiene must_change_password=True
        (recuperación con contraseña temporal)."""
        user = User.query.filter_by(id=user_id, is_deleted=False).first()
        if not user:
            return {"error": "Usuario no encontrado"}, 404
        if not user.must_change_password:
            return {"error": "Este flujo solo aplica para contraseñas temporales."}, 400

        err = _validate_password_strength(new_password)
        if err: return {"error": err}, 400

        if bcrypt.checkpw(new_password.encode('utf-8'), user.password.encode('utf-8')):
            return {"error": "La nueva contraseña no puede ser igual a la temporal."}, 400

        user.password = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        user.must_change_password = False
        db.session.commit()
        AuthService._log_audit(user.id, "PASSWORD_CHANGED_FORCED", ip=request.remote_addr)
        return {"success": True, "message": "Contraseña actualizada. Continúa usando la plataforma."}, 200

    # Legacy: cambio directo (se conserva por si algún cliente viejo lo usa, pero ya no se expone)
    @staticmethod
    def change_password(user_id, old_password, new_password):
        """[Legacy] Cambio directo sin código. Se redirige al flujo en 2 pasos."""
        return AuthService.request_password_change(user_id, old_password, new_password)

    # ─────────────────────────  HELPERS INTERNOS  ────────────────────

    @staticmethod
    def _issue_verification_code(user, purpose: str, minutes: int = 15, payload: str = None):
        """Invalida códigos previos del mismo propósito y emite uno nuevo."""
        VerificationCode.query.filter_by(
            user_id=user.id, purpose=purpose, is_used=False
        ).update({"is_used": True})

        code = _generate_6digit_code()
        vc = VerificationCode(
            user_id=user.id,
            purpose=purpose,
            code_hash=_hash_code(code),
            payload=payload,
            expires_at=datetime.utcnow() + timedelta(minutes=minutes),
        )
        db.session.add(vc)
        db.session.commit()

        # Enviar correo según propósito
        if purpose == 'ACCOUNT_VERIFY':
            EmailService.send_verification_code(user.email, code, user.name)
        elif purpose == 'PASSWORD_CHANGE':
            EmailService.send_password_change_code(user.email, code, user.name)

        return vc

    @staticmethod
    def _consume_code(user_id, code, purpose: str):
        """Busca, valida y consume un código. Retorna el VC o un dict de error."""
        if not code or not code.strip():
            return {"error": "Código requerido"}
        code = code.strip()

        vc = (VerificationCode.query
              .filter_by(user_id=user_id, purpose=purpose, is_used=False)
              .order_by(VerificationCode.created_at.desc())
              .first())

        if not vc:
            return {"error": "No hay un código pendiente. Solicita uno nuevo."}

        if vc.expires_at < datetime.utcnow():
            vc.is_used = True
            db.session.commit()
            return {"error": "El código expiró. Solicita uno nuevo."}

        vc.attempts += 1
        if vc.attempts > 5:
            vc.is_used = True
            db.session.commit()
            return {"error": "Demasiados intentos. Solicita un nuevo código."}

        if vc.code_hash != _hash_code(code):
            db.session.commit()
            return {"error": "Código incorrecto."}

        vc.is_used = True
        db.session.commit()
        return vc

    @staticmethod
    def _mask_email(email: str) -> str:
        try:
            local, domain = email.split('@', 1)
            if len(local) <= 2:
                masked = local[0] + '*'
            else:
                masked = local[0] + '*' * (len(local) - 2) + local[-1]
            return f"{masked}@{domain}"
        except Exception:
            return email

    @staticmethod
    def _user_payload(user):
        return {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": {"name": user.role.name} if user.role else {"name": "APRENDIZ"},
            "profile_image": user.profile_image,
            "dependency_id": user.dependency_id,
            "dependency_name": user.dependency_obj.name if user.dependency_obj else None,
            "must_change_password": bool(user.must_change_password),
        }

    @staticmethod
    def _log_audit(user_id, action, ip=None):
        log = AuditLog(
            user_id=user_id,
            action=action,
            ip=ip,
            user_agent=request.user_agent.string if request.user_agent else None,
        )
        db.session.add(log)
        db.session.commit()
