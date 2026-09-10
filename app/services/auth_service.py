import bcrypt
import re
import secrets
import string
import hashlib
import json
from typing import Optional
from datetime import datetime, timedelta
import requests
from flask import request, current_app
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy import or_
from ..extensions import db
from ..models.user import User, Role
from ..models.movement import Notification
from ..models.audit_log import AuditLog
from ..models.token import PasswordResetToken
from ..models.verification_code import VerificationCode
from ..models.pending_registration import PendingRegistration
from ..models.trusted_device import TrustedDevice
from .token_service import TokenService
from .email_service import EmailService
from flask_jwt_extended import create_access_token
import pyotp


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


# ── Enlace del correo de verificación ────────────────────────────────
# El botón "Ir a la plataforma" del correo lleva un token firmado con el email.
# Al abrirlo (en cualquier dispositivo) el frontend pide los datos del registro
# pendiente y precarga el formulario + salta al paso del código.
_VERIFY_LINK_SALT = 'pending-registration-link'
_VERIFY_LINK_MAX_AGE = 60 * 60  # margen de la firma; la validez real la da pending.expires_at


def _link_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt=_VERIFY_LINK_SALT)


def _device_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt='device-approval-link')


def _poll_serializer() -> URLSafeTimedSerializer:
    """Ticket firmado que conserva el dispositivo ORIGINAL para consultar si ya
    fue autorizado desde el correo (aunque el correo se abra en otro dispositivo)."""
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt='device-approval-poll')


def _public_base_url() -> str:
    raw = current_app.config.get('PUBLIC_BASE_URL') or 'https://sena.newonline.digital'
    return raw.rstrip('/')


# ── Dispositivo y ubicación (para el correo de "dispositivo nuevo") ──

_PRIVATE_IP_PREFIXES = ('127.', '10.', '192.168.', '172.16.', '172.17.', '172.18.',
                        '172.19.', '172.2', '172.30.', '172.31.', '::1', 'fc', 'fd', '169.254.')


def _client_ip() -> str:
    """IP real del cliente, teniendo en cuenta el proxy de Coolify/Traefik."""
    xff = request.headers.get('X-Forwarded-For', '')
    if xff:
        return xff.split(',')[0].strip()
    return (request.headers.get('X-Real-IP') or request.remote_addr or '').strip()


def _describe_user_agent(ua: str) -> str:
    """'Chrome en Windows' a partir del User-Agent (sin dependencias externas)."""
    ua = ua or ''
    if 'Edg/' in ua:
        browser = 'Edge'
    elif 'OPR/' in ua or 'Opera' in ua:
        browser = 'Opera'
    elif 'Firefox/' in ua:
        browser = 'Firefox'
    elif 'Chrome/' in ua and 'Chromium' not in ua:
        browser = 'Chrome'
    elif 'Safari/' in ua and 'Chrome/' not in ua:
        browser = 'Safari'
    else:
        browser = 'Navegador'

    if 'Windows NT' in ua:
        system = 'Windows'
    elif 'Android' in ua:
        system = 'Android'
    elif 'iPhone' in ua or 'iPad' in ua:
        system = 'iOS'
    elif 'Mac OS X' in ua or 'Macintosh' in ua:
        system = 'macOS'
    elif 'Linux' in ua:
        system = 'Linux'
    else:
        system = 'dispositivo desconocido'

    return f"{browser} en {system}"


def _geolocate(ip: str) -> Optional[str]:
    """'Ciudad, Región, País' aproximado a partir de la IP. None si no se puede."""
    if not ip or ip.startswith(_PRIVATE_IP_PREFIXES) or ip in ('localhost', '::1'):
        return None
    try:
        r = requests.get(
            f"http://ip-api.com/json/{ip}",
            params={"fields": "status,country,regionName,city", "lang": "es"},
            timeout=4,
        )
        d = r.json()
        if d.get("status") != "success":
            return None
        parts = [d.get("city"), d.get("regionName"), d.get("country")]
        return ", ".join(p for p in parts if p) or None
    except Exception:
        return None


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

    @staticmethod
    def _get_user_agent():
        # OJO: request.user_agent es "falsy" en Werkzeug 3 si no hay parser de UA
        # instalado, así que leemos la cabecera directamente.
        try:
            s = (request.headers.get('User-Agent') or '').strip()
            return s[:500] if s else None
        except Exception:
            return None

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

        # 2) Duplicados en User
        existing = User.query.filter(
            or_(User.email == email.strip().lower(), User.id == str(document_number))
        ).first()
        if existing:
            if existing.is_deleted:
                return {"error": "Esta cuenta fue eliminada. Contacta al administrador."}, 400
            return {"error": "El correo o número de documento ya está registrado"}, 400

        # Verificar si ya existe un registro pendiente para no acumular
        pending = PendingRegistration.query.filter_by(email=email.strip().lower()).first()
        if pending and pending.expires_at > datetime.utcnow():
             return {"error": "Ya hay un registro pendiente para este correo. Por favor, revisa tu bandeja de entrada o espera 15 minutos."}, 400

        # 3) Guardar en tabla temporal
        hashed_pw = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

        if not role_id:
            role = Role.query.filter_by(name='APRENDIZ').first()
            if not role:
                return {"error": "El rol APRENDIZ no existe en la base de datos"}, 500
            role_id = role.id

        final_ficha = formation_ficha.strip() if formation_ficha and formation_ficha.strip() else None

        payload = {
            "id": str(document_number),
            "document_type": document_type or 'CC',
            "name": name.strip(),
            "phone": phone.strip() if phone else None,
            "password": hashed_pw,
            "role_id": role_id,
            "formation_ficha": final_ficha,
        }

        # Generar código
        code = _generate_6digit_code()
        
        # Eliminar pendientes previos expirados o no
        if pending:
            db.session.delete(pending)

        new_pending = PendingRegistration(
            email=email.strip().lower(),
            document_number=str(document_number),
            payload=json.dumps(payload),
            code_hash=_hash_code(code),
            expires_at=datetime.utcnow() + timedelta(minutes=15)
        )
        db.session.add(new_pending)
        db.session.commit()

        # 4) Enviar correo. Si falla, el registro queda en un callejón sin salida
        #    (no hay forma de verificar), así que revertimos el pendiente para que
        #    la persona pueda reintentar de inmediato — de lo contrario el chequeo
        #    de "ya hay un registro pendiente" la bloquearía 15 minutos.
        verify_link = AuthService.make_verify_link(new_pending.email, code)
        sent = EmailService.send_verification_code(new_pending.email, code, name.strip(), verify_link=verify_link)
        if not sent:
            db.session.delete(new_pending)
            db.session.commit()
            return {
                "error": "No pudimos enviar el código de verificación a tu correo. "
                         "Verifica que la dirección esté bien escrita e inténtalo de nuevo en unos minutos."
            }, 502

        return {
            "success": True,
            "message": "Registro recibido. Revisa tu correo y verifica con el código de 6 dígitos para crear tu cuenta.",
            "requires_verification": True,
            "email": new_pending.email,
        }, 201

    @staticmethod
    def verify_account(email, code):
        """Verifica una cuenta recién registrada usando el código de 6 dígitos."""
        if not email or not code:
            return {"error": "Correo y código son requeridos"}, 400

        email = email.strip().lower()
        code = code.strip()

        # Check if already verified
        user = User.query.filter_by(email=email, is_deleted=False).first()
        if user:
            return {"success": True, "message": "Tu cuenta ya está verificada. Inicia sesión."}, 200

        pending = PendingRegistration.query.filter_by(email=email).first()
        if not pending:
            return {"error": "No hay un registro pendiente para este correo."}, 404

        if pending.expires_at < datetime.utcnow():
            db.session.delete(pending)
            db.session.commit()
            return {"error": "El código expiró. Vuelve a registrarte."}, 400

        if pending.attempts >= 5:
            db.session.delete(pending)
            db.session.commit()
            return {"error": "Demasiados intentos fallidos. Vuelve a registrarte."}, 400

        pending.attempts += 1

        if pending.code_hash != _hash_code(code):
            db.session.commit()
            return {"error": "Código incorrecto."}, 400

        # Crear el usuario oficial
        payload = json.loads(pending.payload)
        
        # Generar TOTP Secret
        totp_secret = pyotp.random_base32()
        
        new_user = User(
            id=payload["id"],
            document_type=payload.get("document_type", "CC"),
            name=payload["name"],
            email=email,
            phone=payload.get("phone"),
            password=payload["password"],
            role_id=payload["role_id"],
            formation_ficha=payload.get("formation_ficha"),
            is_verified=True,
            totp_secret=totp_secret,
            is_2fa_enabled=True
        )
        db.session.add(new_user)
        db.session.delete(pending)
        db.session.commit()

        AuthService._log_audit(new_user.id, "ACCOUNT_VERIFIED_AND_CREATED", ip=request.remote_addr)

        # Generar URI de Authenticator
        totp = pyotp.TOTP(totp_secret)
        otpauth_url = totp.provisioning_uri(name=email, issuer_name="Biblioteca SENA")

        # Auto-login tras verificar
        access, refresh = TokenService.generate_auth_tokens(new_user, AuthService._get_user_agent())
        return {
            "success": True,
            "message": "Cuenta creada y verificada exitosamente.",
            "access_token": access,
            "refresh_token": refresh,
            "user": AuthService._user_payload(new_user),
            "totp_secret": totp_secret,
            "otpauth_url": otpauth_url
        }, 200

    @staticmethod
    def resend_verification(email):
        """Reenvía el código de verificación si la cuenta sigue sin verificar."""
        if not email:
            return {"error": "Correo requerido"}, 400
            
        email = email.strip().lower()
        user = User.query.filter_by(email=email, is_deleted=False).first()
        if user and user.is_verified:
            return {"success": True, "message": "Tu cuenta ya está verificada."}, 200

        pending = PendingRegistration.query.filter_by(email=email).first()
        if not pending:
             return {"success": True, "message": "Si hay un registro pendiente, se reenvió el código."}, 200
             
        code = _generate_6digit_code()
        pending.code_hash = _hash_code(code)
        pending.expires_at = datetime.utcnow() + timedelta(minutes=15)
        pending.attempts = 0
        db.session.commit()
        
        try:
             payload = json.loads(pending.payload)
             name = payload.get("name", "")
        except:
             name = ""
             
        sent = EmailService.send_verification_code(
            email, code, name, verify_link=AuthService.make_verify_link(email, code)
        )
        if not sent:
            return {"error": "No pudimos reenviar el código en este momento. Inténtalo más tarde."}, 502
        return {"success": True, "message": "Código reenviado."}, 200

    @staticmethod
    def make_verify_link(email: str, code: str = None) -> str:
        """URL para el botón del correo: /register?verify=<token firmado>.
        El token lleva el email (para precargar el formulario) y el código (para
        autocompletar el campo). Va firmado — no cifrado — pero solo viaja en el
        correo (donde el código ya aparece a la vista) y el frontend lo borra de
        la URL nada más leerlo."""
        payload = {"e": (email or '').strip().lower()}
        if code:
            payload["c"] = str(code)
        token = _link_serializer().dumps(payload)
        return f"{_public_base_url()}/register?verify={token}"

    @staticmethod
    def get_pending_registration(token: str):
        """Datos del registro pendiente asociado a un token de enlace, si sigue vigente.
        Sirve para precargar el formulario, saltar al paso del código y autocompletar
        el código desde cualquier dispositivo (todo viene del servidor / del token
        firmado, no del navegador que registró)."""
        if not token:
            return {"found": False, "reason": "missing_token"}, 200

        try:
            data = _link_serializer().loads(token, max_age=_VERIFY_LINK_MAX_AGE)
        except SignatureExpired:
            return {"found": False, "reason": "expired"}, 200
        except BadSignature:
            return {"found": False, "reason": "invalid"}, 200

        # Compatibilidad: enlaces antiguos llevaban el email como texto plano.
        if isinstance(data, dict):
            email = (data.get("e") or "").strip().lower()
            link_code = data.get("c")
        else:
            email = (data or "").strip().lower()
            link_code = None

        if User.query.filter_by(email=email, is_deleted=False).first():
            return {"found": False, "reason": "already_verified", "email": email}, 200

        pending = PendingRegistration.query.filter_by(email=email).first()
        if not pending:
            return {"found": False, "reason": "not_found", "email": email}, 200

        now = datetime.utcnow()
        if pending.expires_at < now:
            return {"found": False, "reason": "expired", "email": email}, 200

        try:
            payload = json.loads(pending.payload)
        except Exception:
            payload = {}

        result = {
            "found": True,
            "email": email,
            "name": payload.get("name", ""),
            "phone": payload.get("phone") or "",
            "document_type": payload.get("document_type", "CC"),
            "document_number": payload.get("id") or pending.document_number or "",
            "formation_ficha": payload.get("formation_ficha") or "",
            "expires_at": pending.expires_at.isoformat(),
            "seconds_left": max(int((pending.expires_at - now).total_seconds()), 0),
        }
        # Solo devolvemos el código si coincide con el vigente (no uno reenviado/caducado).
        if link_code and _hash_code(str(link_code)) == pending.code_hash:
            result["code"] = str(link_code)
        return result, 200

    # ── Login ─────────────────────────────────────────────────────────

    @staticmethod
    def login(identifier, password, device_id=None, accepted_tos=False):
        """Autentica ÚNICAMENTE con número de documento. Bloquea login si la cuenta no está verificada.
        Si el dispositivo no está en `trusted_devices`, envía un correo de autorización
        en lugar de iniciar sesión."""
        document = (identifier or '').strip()
        user = User.query.filter(
            User.id == document,
            User.is_deleted == False
        ).first()

        if not user:
            return {"error": "No encontramos ninguna cuenta con ese número de documento."}, 401

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
            remaining = max(0, 5 - user.failed_attempts)
            if remaining == 0:
                msg = "Contraseña incorrecta. El próximo intento fallido bloqueará la cuenta."
            elif remaining <= 2:
                msg = f"Contraseña incorrecta. Te quedan {remaining} intento(s) antes de bloquear la cuenta."
            else:
                msg = "La contraseña es incorrecta."
            return {"error": msg}, 401

        if accepted_tos:
            try:
                AuthService._log_audit(user.id, "TOS_ACCEPTED", ip=request.remote_addr)
            except Exception:
                pass

        if not user.is_verified:
            # Solo reemitir código si el usuario tiene este mecanismo (creado vía registro normal)
            if hasattr(user, 'id'):
                try:
                    AuthService._issue_verification_code(user, purpose='ACCOUNT_VERIFY', minutes=15)
                except Exception:
                    pass
            return {
                "error": "Debes verificar tu correo antes de iniciar sesión.",
                "requires_verification": True,
                "email": user.email,
            }, 403

        # ── Dispositivo nuevo: pedir autorización por correo ─────────────
        # Envuelto en try/except: si algo falla aquí (BD, correo, geo), NUNCA
        # debe bloquear el inicio de sesión — se cae al flujo normal (2FA/entrar).
        try:
            device_trusted = AuthService._is_trusted_device(user.id, device_id)
        except Exception as e:
            print(f"[device-approval] no se pudo comprobar el dispositivo, se omite: {e}")
            db.session.rollback()
            device_trusted = True

        if user.email and not device_trusted:
            try:
                user.failed_attempts = 0
                user.last_failed_login = None
                db.session.commit()
                sent = AuthService._send_device_approval(user, device_id)
            except Exception as e:
                print(f"[device-approval] fallo al enviar la autorización, se omite: {e}")
                db.session.rollback()
                sent = None

            if sent:
                poll_token = _poll_serializer().dumps({"uid": str(user.id), "did": device_id or ''}) if device_id else None
                return {
                    "requires_device_approval": True,
                    "message": "Detectamos un inicio de sesión desde un dispositivo nuevo. "
                               "Te enviamos un correo para autorizarlo.",
                    "email_hint": AuthService._mask_email(user.email),
                    "poll_token": poll_token,
                }, 200
            if sent is False:
                return {"error": "No pudimos enviar el correo de autorización. Inténtalo de nuevo en unos minutos."}, 502
            # sent is None -> excepción inesperada: continuar con el login normal

        # 2FA check
        if user.is_2fa_enabled and user.totp_secret:
            # En lugar de loguearlo inmediatamente, devolvemos un token temporal
            temp_token = create_access_token(
                identity=str(user.id),
                additional_claims={"type": "2fa_temp"},
                expires_delta=timedelta(minutes=10)
            )
            return {
                "requires_2fa": True,
                "temp_token": temp_token,
                "message": "Verificación en dos pasos requerida.",
                "email_hint": AuthService._mask_email(user.email) if user.email else None,
            }, 200

        # Éxito sin 2FA
        user.failed_attempts = 0
        user.last_failed_login = None
        user.last_login = datetime.utcnow()
        db.session.add(Notification(
            user_id=str(user.id),
            type='NEW_LOGIN',
            title='Nuevo inicio de sesión',
            message=f'Se detectó un inicio de sesión en tu cuenta desde {request.remote_addr}.',
        ))
        db.session.commit()

        access, refresh = TokenService.generate_auth_tokens(user, AuthService._get_user_agent())
        AuthService._log_audit(user.id, "LOGIN_SUCCESS", ip=request.remote_addr)

        return {
            "access_token": access,
            "refresh_token": refresh,
            "must_change_password": bool(user.must_change_password),
            "user": AuthService._user_payload(user),
        }, 200

    @staticmethod
    def send_2fa_email(user_id):
        """Genera un código 2FA y lo envía al correo del usuario.
        Se llama con el token temporal de 2FA (tras validar usuario+contraseña)."""
        user = User.query.filter_by(id=user_id, is_deleted=False).first()
        if not user or not user.is_active or user.is_blocked:
            return {"error": "Acceso denegado"}, 403

        if not (user.email or '').strip():
            return {"error": "No tienes un correo registrado. Usa tu app de autenticación."}, 400

        # Anti-spam: no reenviar si se pidió uno hace menos de 45 s
        recent = (VerificationCode.query
                  .filter_by(user_id=user.id, purpose='LOGIN_2FA_EMAIL', is_used=False)
                  .order_by(VerificationCode.created_at.desc())
                  .first())
        if recent and (datetime.utcnow() - recent.created_at).total_seconds() < 45:
            return {"error": "Espera unos segundos antes de pedir otro código."}, 429

        VerificationCode.query.filter_by(
            user_id=user.id, purpose='LOGIN_2FA_EMAIL', is_used=False
        ).update({"is_used": True})

        code = _generate_6digit_code()
        db.session.add(VerificationCode(
            user_id=user.id,
            purpose='LOGIN_2FA_EMAIL',
            code_hash=_hash_code(code),
            expires_at=datetime.utcnow() + timedelta(minutes=10),
        ))
        db.session.commit()

        sent = EmailService.send_2fa_code(user.email, code, user.name or '')
        if not sent:
            return {"error": "No pudimos enviar el correo. Inténtalo de nuevo o usa tu app de autenticación."}, 502

        AuthService._log_audit(user.id, "2FA_EMAIL_SENT", ip=request.remote_addr)
        return {
            "success": True,
            "message": f"Código enviado a {AuthService._mask_email(user.email)}",
        }, 200

    @staticmethod
    def verify_2fa(user_id, code):
        """Valida el código de dos pasos: acepta tanto el de la app de
        autenticación (TOTP) como el enviado por correo."""
        user = User.query.filter_by(id=user_id, is_deleted=False).first()
        if not user or not user.is_active or user.is_blocked:
            return {"error": "Acceso denegado"}, 403

        code = (code or '').strip()

        ok = False
        # 1) Código de la app de autenticación
        if user.totp_secret:
            try:
                ok = pyotp.TOTP(user.totp_secret).verify(code)
            except Exception:
                ok = False
        # 2) Código enviado por correo
        if not ok:
            vc = AuthService._consume_code(user.id, code, purpose='LOGIN_2FA_EMAIL')
            ok = not isinstance(vc, dict)

        if not ok:
            return {"error": "Código 2FA incorrecto"}, 401

        # Éxito
        user.failed_attempts = 0
        user.last_failed_login = None
        user.last_login = datetime.utcnow()
        db.session.add(Notification(
            user_id=str(user.id),
            type='NEW_LOGIN',
            title='Nuevo inicio de sesión',
            message=f'Se detectó un inicio de sesión en tu cuenta desde {request.remote_addr}.',
        ))
        db.session.commit()

        access, refresh = TokenService.generate_auth_tokens(user, AuthService._get_user_agent())
        AuthService._log_audit(user.id, "LOGIN_SUCCESS_2FA", ip=request.remote_addr)

        return {
            "access_token": access,
            "refresh_token": refresh,
            "must_change_password": bool(user.must_change_password),
            "user": AuthService._user_payload(user),
        }, 200

    # ── Autorización de dispositivo nuevo ────────────────────────────

    @staticmethod
    def _is_trusted_device(user_id, device_id):
        if not device_id:
            return False
        return TrustedDevice.query.filter_by(
            user_id=str(user_id), device_id=str(device_id)
        ).first() is not None

    @staticmethod
    def _send_device_approval(user, device_id) -> bool:
        """Crea un enlace de un solo uso (15 min) y manda el correo de 'dispositivo nuevo'."""
        ip = _client_ip()
        ua = AuthService._get_user_agent() or ''
        label = _describe_user_agent(ua)
        location = _geolocate(ip)
        when = datetime.now().strftime('%d/%m/%Y %H:%M')

        nonce = secrets.token_urlsafe(24)
        VerificationCode.query.filter_by(
            user_id=user.id, purpose='DEVICE_APPROVAL', is_used=False
        ).update({"is_used": True})
        db.session.add(VerificationCode(
            user_id=user.id,
            purpose='DEVICE_APPROVAL',
            code_hash=_hash_code(nonce),
            payload=json.dumps({
                "device_id": device_id or '',
                "label": label,
                "ip": ip,
                "location": location or '',
            }),
            expires_at=datetime.utcnow() + timedelta(minutes=15),
        ))
        db.session.commit()

        token = _device_serializer().dumps({"uid": str(user.id), "n": nonce})
        link = f"{_public_base_url()}/aprobar-dispositivo?token={token}"

        sent = EmailService.send_new_device_alert(
            user.email, user.name or '', link,
            device_label=label, location=location, ip=ip, when=when,
        )
        if sent:
            AuthService._log_audit(user.id, "DEVICE_APPROVAL_SENT", ip=ip)
        return sent

    @staticmethod
    def approve_device(token, request_device_id=None):
        """Valida el enlace del correo, marca el dispositivo como de confianza e
        inicia la sesión. Devuelve tokens + usuario (o un error)."""
        if not token:
            return {"error": "Enlace inválido."}, 400
        try:
            data = _device_serializer().loads(token, max_age=15 * 60)
        except SignatureExpired:
            return {"error": "Este enlace expiró. Vuelve a iniciar sesión para recibir uno nuevo."}, 400
        except BadSignature:
            return {"error": "Enlace inválido."}, 400

        uid = str(data.get("uid") or '')
        nonce = data.get("n") or ''
        user = User.query.filter_by(id=uid, is_deleted=False).first()
        if not user or not user.is_active or user.is_blocked:
            return {"error": "No pudimos completar el acceso."}, 403

        vc = (VerificationCode.query
              .filter_by(user_id=uid, purpose='DEVICE_APPROVAL', is_used=False)
              .order_by(VerificationCode.created_at.desc())
              .first())
        if not vc or vc.expires_at < datetime.utcnow() or vc.code_hash != _hash_code(nonce):
            return {"error": "Este enlace expiró o ya se usó. Vuelve a iniciar sesión."}, 400
        vc.is_used = True

        try:
            meta = json.loads(vc.payload or '{}')
        except Exception:
            meta = {}

        # Confiar en el dispositivo que inició el login y también en el que abre el enlace
        for did in {(meta.get("device_id") or ''), (request_device_id or '')}:
            if not did:
                continue
            td = TrustedDevice.query.filter_by(user_id=uid, device_id=did).first()
            if td:
                td.last_seen_at = datetime.utcnow()
                td.last_ip = meta.get("ip") or td.last_ip
                td.last_location = meta.get("location") or td.last_location
            else:
                db.session.add(TrustedDevice(
                    user_id=uid, device_id=did,
                    label=meta.get("label"),
                    last_ip=meta.get("ip"),
                    last_location=meta.get("location"),
                ))

        user.failed_attempts = 0
        user.last_failed_login = None
        user.last_login = datetime.utcnow()
        db.session.add(Notification(
            user_id=str(user.id),
            type='NEW_LOGIN',
            title='Nuevo dispositivo autorizado',
            message=('Autorizaste un dispositivo nuevo'
                     + (f': {meta.get("label")}' if meta.get("label") else '')
                     + (f' · {meta.get("location")}' if meta.get("location") else '')),
        ))
        db.session.commit()

        access, refresh = TokenService.generate_auth_tokens(user, AuthService._get_user_agent())
        AuthService._log_audit(user.id, "DEVICE_APPROVED", ip=_client_ip())
        return {
            "success": True,
            "message": "Sesión iniciada con éxito.",
            "access_token": access,
            "refresh_token": refresh,
            "must_change_password": bool(user.must_change_password),
            "user": AuthService._user_payload(user),
        }, 200

    @staticmethod
    def check_device_approval(poll_token):
        """Lo consulta el dispositivo ORIGINAL (el que mostró 'revisa tu correo').
        Devuelve 'pending' hasta que se aprueba desde el correo; entonces devuelve
        los tokens para iniciar sesión también en ese dispositivo. Un solo uso."""
        if not poll_token:
            return {"status": "invalid"}, 400
        try:
            data = _poll_serializer().loads(poll_token, max_age=30 * 60)
        except SignatureExpired:
            return {"status": "expired"}, 200
        except BadSignature:
            return {"status": "invalid"}, 400

        uid = str(data.get("uid") or '')
        did = str(data.get("did") or '')
        if not uid or not did:
            return {"status": "pending"}, 200

        user = User.query.filter_by(id=uid, is_deleted=False).first()
        if not user or not user.is_active or user.is_blocked:
            return {"status": "pending"}, 200

        vc = (VerificationCode.query
              .filter_by(user_id=uid, purpose='DEVICE_APPROVAL')
              .order_by(VerificationCode.created_at.desc())
              .first())
        if not vc:
            return {"status": "expired"}, 200
        try:
            meta = json.loads(vc.payload or '{}')
        except Exception:
            meta = {}
        if (meta.get("device_id") or '') != did:
            return {"status": "pending"}, 200
        if not vc.is_used:
            return {"status": "pending"}, 200        # aún no se ha aprobado desde el correo
        if (datetime.utcnow() - vc.created_at) > timedelta(minutes=30):
            return {"status": "expired"}, 200

        # Aprobado y fresco: emitir sesión para el dispositivo original y consumir.
        db.session.delete(vc)
        user.failed_attempts = 0
        user.last_failed_login = None
        user.last_login = datetime.utcnow()
        db.session.commit()

        access, refresh = TokenService.generate_auth_tokens(user, AuthService._get_user_agent())
        AuthService._log_audit(user.id, "LOGIN_SUCCESS_DEVICE", ip=_client_ip())
        return {
            "status": "approved",
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
            # Enviamos ANTES de tocar la contraseña: si el correo no sale, no
            # dejamos al usuario fuera de su cuenta con una temporal que nadie recibió.
            sent = EmailService.send_temporary_password(user.email, temp_pw, user.name)
            if sent:
                user.password = bcrypt.hashpw(temp_pw.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
                user.must_change_password = True
                # Reset bloqueo (la recuperación válida desbloquea)
                user.failed_attempts = 0
                user.is_blocked = False
                # Revocar todas las sesiones activas
                TokenService.revoke_all_user_tokens(user.id)
                db.session.commit()

        # Respuesta neutra (no revelar si existe el correo ni si el envío falló)
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

        sent = AuthService._issue_verification_code(
            user, purpose='PASSWORD_CHANGE', minutes=10, payload=payload
        )
        if not sent:
            return {"error": "No pudimos enviar el código a tu correo. Inténtalo de nuevo en unos minutos."}, 502

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

        # Enviar correo según propósito. Devuelve si el envío tuvo éxito.
        if purpose == 'ACCOUNT_VERIFY':
            return EmailService.send_verification_code(user.email, code, user.name)
        elif purpose == 'PASSWORD_CHANGE':
            return EmailService.send_password_change_code(user.email, code, user.name)
        return True

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
            "profile_image": user.profile_image,
            "role": {"name": user.role.name} if user.role else {"name": "APRENDIZ"},
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
