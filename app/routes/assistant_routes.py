import os
import json
import re
import requests
import string
import time
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from ..models.item import Item
from ..models.loan import Loan
from ..models.user import User
from ..models.reservation import Reservation
from ..models.token import RefreshToken
from ..models.trusted_device import TrustedDevice
from ..models.ai_knowledge import AILearnedResponse, AIUnansweredQuery, AIResponseFeedback
from ..models.assistant_thread import AssistantThread
from ..services.reservation_queue import enqueue_reservation, on_item_available
from .. import db

assistant_bp = Blueprint('assistant', __name__)

# Roles que pueden escalar conversaciones al equipo de Soporte desde el asistente.
# INVITADO no aparece aquí porque no tiene sesión: el frontend le pide iniciar sesión primero.
ESCALATABLE_ROLES = {'APRENDIZ', 'USUARIO', 'ALMACENISTA', 'BIBLIOTECARIO'}


# ─── Acciones automatizadas del asistente (function calling) ─────────────────
# El asistente puede EJECUTAR cosas por el usuario (reservar, cancelar, cerrar
# sesiones, navegar), pero las acciones que cambian datos (reservar, cancelar,
# cerrar sesión) nunca se ejecutan directo desde el texto del modelo: se
# preparan como "acción pendiente" firmada (itsdangerous) y solo se ejecutan
# si el usuario la confirma explícitamente en el chat (ver /confirm-action).
# El token firmado lleva el user_id, así que solo el dueño de la conversación
# puede confirmarla — igual que cualquier otro endpoint protegido por JWT.
ACTION_TOKEN_SALT = 'assistant-pending-action'
ACTION_MAX_AGE = 10 * 60  # 10 minutos

# ─── Ajustes de la IA que aprende (AILearnedResponse) ────────────────────────
LEARNED_RESPONSE_TTL_DAYS = 45     # después de esto, se considera vencida y no se sirve
MIN_MATCH_CONFIDENCE = 0.45        # similitud mínima (Jaccard) entre palabras clave para servirla
NEGATIVE_FEEDBACK_AUTODELETE_MARGIN = 3  # si (negativos - positivos) llega a esto, se autoelimina


def _action_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt=ACTION_TOKEN_SALT)


def _build_assistant_tools():
    """Declaración de funciones (Gemini function calling). Los nombres y
    descripciones están en español porque así son las conversaciones reales;
    el modelo las usa igual de bien en cualquier idioma."""
    return [{
        "functionDeclarations": [
            {
                "name": "listar_sesiones_activas",
                "description": (
                    "Devuelve la lista de sesiones activas (dispositivos con sesión iniciada) "
                    "del usuario. Úsala cuando pida ver sus sesiones, dispositivos conectados, "
                    "o desde dónde tiene la cuenta abierta."
                ),
                "parameters": {"type": "OBJECT", "properties": {}},
            },
            {
                "name": "listar_mis_prestamos",
                "description": "Devuelve los préstamos activos del usuario (elementos que tiene prestados ahora mismo).",
                "parameters": {"type": "OBJECT", "properties": {}},
            },
            {
                "name": "listar_mis_reservas",
                "description": "Devuelve las reservas activas del usuario (en cola o listas para reclamar).",
                "parameters": {"type": "OBJECT", "properties": {}},
            },
            {
                "name": "navegar_a",
                "description": (
                    "Genera un enlace directo para llevar al usuario a una sección de la "
                    "plataforma (configuración, sesiones, reservas, préstamos, catálogo, "
                    "usuarios, inventario, reportes, etc.). Úsala siempre que el usuario pida "
                    "ir, abrir o navegar a alguna parte, en vez de solo explicarle los clics."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "destino": {"type": "STRING", "description": "A qué sección quiere ir el usuario, en sus propias palabras."},
                    },
                    "required": ["destino"],
                },
            },
            {
                "name": "reservar_elemento",
                "description": (
                    "Prepara la reserva de un libro, herramienta o equipo del catálogo para el "
                    "usuario. NO la ejecuta de inmediato: el sistema le pedirá confirmación "
                    "antes de crearla de verdad."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "elemento": {"type": "STRING", "description": "Nombre o código del elemento que quiere reservar."},
                    },
                    "required": ["elemento"],
                },
            },
            {
                "name": "cancelar_mi_reserva",
                "description": (
                    "Prepara la cancelación de una reserva activa del usuario. NO la ejecuta de "
                    "inmediato: el sistema le pedirá confirmación antes de cancelarla de verdad."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "elemento": {"type": "STRING", "description": "Nombre del elemento reservado que quiere cancelar."},
                    },
                    "required": ["elemento"],
                },
            },
            {
                "name": "cerrar_sesion_dispositivo",
                "description": (
                    "Prepara el cierre de una sesión/dispositivo. Usa 'actual' para el "
                    "dispositivo desde el que está escribiendo ahora mismo, 'todas' para cerrar "
                    "todas las sesiones, o una descripción del dispositivo (ej. 'el de Windows'). "
                    "NO la ejecuta de inmediato: el sistema pedirá confirmación."
                ),
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "objetivo": {"type": "STRING", "description": "'actual', 'todas', o una descripción del dispositivo a cerrar."},
                    },
                    "required": ["objetivo"],
                },
            },
        ],
    }]


# Mapa de navegación por rol: base de ruta + {slug: (etiqueta, [palabras clave])}.
# Los slugs son exactamente los que cada dashboard ya reconoce en su router
# interno (activeSection), así que "navegar" es solo construir base+slug.
ROLE_NAV_SECTIONS = {
    'ADMIN': ('/admin', {
        'dashboard': ('Panel principal', ['inicio', 'panel', 'dashboard', 'resumen', 'home']),
        'config': ('Configuración de seguridad', ['configuracion', 'configuración', 'perfil', 'cuenta', 'seguridad', 'sesion', 'sesión', 'sesiones', 'dispositivo', 'dispositivos', 'contraseña', 'clave']),
        'users': ('Gestión de usuarios', ['usuario', 'usuarios']),
        'audit': ('Auditoría', ['auditoria', 'auditoría']),
        'loans': ('Préstamos', ['prestamo', 'préstamo', 'prestamos', 'préstamos']),
        'reservations': ('Reservas', ['reserva', 'reservas']),
        'maintenance': ('Mantenimiento', ['mantenimiento']),
        'reports': ('Reportes', ['reporte', 'reportes', 'estadistica', 'estadística']),
        'inventory': ('Inventario', ['inventario', 'catalogo', 'catálogo', 'elementos']),
        'exits': ('Salidas', ['salida', 'salidas']),
        'help': ('Asistente', ['asistente', 'ayuda', 'chat']),
        'solicitudes': ('Solicitudes', ['solicitud', 'solicitudes', 'ticket', 'tickets']),
        'notifications': ('Notificaciones', ['notificacion', 'notificación', 'notificaciones']),
        'ai-knowledge': ('Conocimiento del Asistente', ['conocimiento', 'ia', 'inteligencia artificial', 'aprendizaje del bot', 'panel de ia']),
    }),
    'BIBLIOTECARIO': ('/bibliotecario', {
        'home': ('Inicio', ['inicio', 'panel', 'dashboard', 'resumen', 'home']),
        'inventory': ('Libros', ['inventario', 'libro', 'libros', 'catalogo', 'catálogo']),
        'inventory-locations': ('Ubicaciones', ['ubicacion', 'ubicación', 'ubicaciones']),
        'inventory-categories': ('Categorías', ['categoria', 'categoría', 'categorias']),
        'loans': ('Préstamos', ['prestamo', 'préstamo', 'prestamos', 'préstamos']),
        'config': ('Configuración de seguridad', ['configuracion', 'configuración', 'perfil', 'cuenta', 'seguridad', 'sesion', 'sesión', 'sesiones', 'dispositivo', 'dispositivos']),
        'help': ('Asistente', ['asistente', 'ayuda', 'chat']),
        'solicitudes': ('Solicitudes', ['solicitud', 'solicitudes', 'chat interno']),
        'notifications': ('Notificaciones', ['notificacion', 'notificación', 'notificaciones']),
    }),
    'ALMACENISTA': ('/almacenista', {
        'home': ('Inicio', ['inicio', 'panel', 'dashboard', 'resumen', 'home']),
        'inventory': ('Almacén', ['inventario', 'almacen', 'almacén', 'herramienta', 'herramientas', 'equipo', 'equipos', 'catalogo', 'catálogo']),
        'inventory-locations': ('Ubicaciones', ['ubicacion', 'ubicación', 'ubicaciones']),
        'inventory-categories': ('Categorías', ['categoria', 'categoría', 'categorias']),
        'loans': ('Préstamos', ['prestamo', 'préstamo', 'prestamos', 'préstamos']),
        'config': ('Configuración de seguridad', ['configuracion', 'configuración', 'perfil', 'cuenta', 'seguridad', 'sesion', 'sesión', 'sesiones', 'dispositivo', 'dispositivos']),
        'help': ('Asistente', ['asistente', 'ayuda', 'chat']),
        'solicitudes': ('Solicitudes', ['solicitud', 'solicitudes', 'chat interno']),
        'notifications': ('Notificaciones', ['notificacion', 'notificación', 'notificaciones']),
    }),
    'SOPORTE': ('/soporte', {
        'dashboard': ('Inicio', ['inicio', 'panel', 'dashboard', 'resumen', 'home']),
        'config': ('Configuración de seguridad', ['configuracion', 'configuración', 'perfil', 'cuenta', 'seguridad', 'sesion', 'sesión', 'sesiones', 'dispositivo', 'dispositivos']),
        'mantenimientos': ('Mantenimiento', ['mantenimiento', 'mantenimientos']),
        'help': ('Asistente', ['asistente', 'ayuda', 'chat']),
        'reportes': ('Reportes', ['reporte', 'reportes']),
        'incidencias': ('Incidencias', ['incidencia', 'incidencias']),
        'historial': ('Historial', ['historial']),
        'repuestos': ('Repuestos', ['repuesto', 'repuestos']),
        'solicitudes': ('Solicitudes', ['solicitud', 'solicitudes', 'ticket', 'tickets']),
        'staff-chat': ('Chat interno', ['chat interno', 'chat con soporte']),
        'notifications': ('Notificaciones', ['notificacion', 'notificación', 'notificaciones']),
    }),
}
DEFAULT_NAV = ('/dashboard', {
    'home': ('Inicio', ['inicio', 'panel', 'dashboard', 'resumen', 'home']),
    'explore': ('Explorar catálogo', ['catalogo', 'catálogo', 'explorar', 'elementos', 'libros', 'herramientas', 'equipos']),
    'loans': ('Mis préstamos', ['prestamo', 'préstamo', 'prestamos', 'préstamos']),
    'reservations': ('Mis reservas', ['reserva', 'reservas']),
    'history': ('Historial', ['historial']),
    'config': ('Configuración de seguridad', ['configuracion', 'configuración', 'perfil', 'cuenta', 'seguridad', 'sesion', 'sesión', 'sesiones', 'dispositivo', 'dispositivos', 'contraseña', 'clave']),
    'help': ('Asistente', ['asistente', 'ayuda', 'chat']),
    'notifications': ('Notificaciones', ['notificacion', 'notificación', 'notificaciones']),
})


def _resolve_nav(role, destino_text):
    base, sections = ROLE_NAV_SECTIONS.get(role, DEFAULT_NAV)
    d = (destino_text or '').lower().strip()
    best, best_score = None, 0
    for slug, (label, aliases) in sections.items():
        score = sum(1 for a in aliases if a in d)
        if score > best_score:
            best_score, best = score, (slug, label)
    if not best:
        return None
    slug, label = best
    return {"route": f"{base}/{slug}", "label": label}


def _tool_list_sessions(user_id):
    from ..services.auth_service import _describe_user_agent
    current_sid = get_jwt().get('sid')
    now = datetime.utcnow()
    tokens = (RefreshToken.query
              .filter_by(user_id=user_id, is_revoked=False)
              .filter(RefreshToken.expires_at > now)
              .order_by(RefreshToken.created_at.desc()).all())
    trusted = {d.device_id: d for d in TrustedDevice.query.filter_by(user_id=user_id).all()}
    out = []
    for t in tokens:
        td = trusted.get(t.device_id) if t.device_id else None
        out.append({
            "dispositivo": (td.label if td and td.label else None) or _describe_user_agent(t.user_agent or ''),
            "ubicacion": (td.last_location if td else None) or "Desconocida",
            "es_este_dispositivo": bool(current_sid and t.id == current_sid),
            "iniciada": t.created_at.strftime('%Y-%m-%d %H:%M') if t.created_at else None,
        })
    return {"sesiones": out, "total": len(out)}


def _tool_list_loans(user):
    if not user:
        return {"prestamos": [], "total": 0}
    loans = Loan.query.filter_by(user_id=str(user.id)).filter(Loan.status.in_(['ACTIVE', 'OVERDUE'])).all()
    out = []
    for l in loans:
        for d in l.details:
            out.append({
                "elemento": d.item.name,
                "codigo": d.item.code,
                "entregar_antes_de": l.due_date.strftime('%Y-%m-%d %H:%M') if l.due_date else None,
                "estado": l.status,
            })
    return {"prestamos": out, "total": len(out)}


def _tool_list_reservations(user_id):
    res_list = (Reservation.query.filter_by(user_id=str(user_id))
                .filter(Reservation.status.in_(['QUEUED', 'READY']))
                .order_by(Reservation.reservation_date.desc()).all())
    out = []
    for r in res_list:
        item = Item.query.get(r.item_id)
        out.append({
            "elemento": item.name if item else "Eliminado",
            "estado": "En cola" if r.status == 'QUEUED' else "Lista para reclamar",
            "expira": r.expiration_date.strftime('%Y-%m-%d %H:%M') if r.expiration_date else None,
        })
    return {"reservas": out, "total": len(out)}


def _tool_propose_reserve(user_id, elemento_text):
    q = (elemento_text or '').strip()
    if not q:
        return {"error": "Necesito el nombre del elemento que quieres reservar."}
    matches = Item.query.filter(db.or_(Item.name.ilike(f"%{q}%"), Item.code.ilike(f"%{q}%"))).limit(6).all()
    if not matches:
        return {"error": f"No encontré ningún elemento del catálogo que coincida con \"{q}\"."}
    if len(matches) > 1:
        nombres = ", ".join(m.name for m in matches[:5])
        return {"error": f"Encontré varios elementos que coinciden con \"{q}\": {nombres}. ¿Cuál exactamente?"}
    item = matches[0]
    action = {"action": "crear_reserva", "user_id": str(user_id), "params": {"item_id": item.id, "item_name": item.name}}
    token = _action_serializer().dumps(action)
    return {
        "pending_confirmation": True,
        "resumen": f'Reservar "{item.name}" (código {item.code})',
        "token": token,
    }


def _tool_propose_cancel(user_id, elemento_text):
    q = (elemento_text or '').strip()
    res_list = (Reservation.query.filter_by(user_id=str(user_id))
                .filter(Reservation.status.in_(['QUEUED', 'READY'])).all())
    if not res_list:
        return {"error": "No tienes ninguna reserva activa para cancelar."}
    pairs = [(r, Item.query.get(r.item_id)) for r in res_list]
    if q:
        pairs = [(r, it) for r, it in pairs if it and q.lower() in it.name.lower()]
    if not pairs:
        return {"error": f"No encontré ninguna reserva activa tuya que coincida con \"{q}\"."}
    if len(pairs) > 1:
        nombres = ", ".join((it.name if it else "?") for _, it in pairs[:5])
        return {"error": f"Tienes varias reservas activas que coinciden: {nombres}. ¿Cuál exactamente?"}
    r, item = pairs[0]
    item_name = item.name if item else "el elemento"
    action = {"action": "cancelar_reserva", "user_id": str(user_id), "params": {"reservation_id": r.id, "item_name": item_name}}
    token = _action_serializer().dumps(action)
    return {
        "pending_confirmation": True,
        "resumen": f'Cancelar la reserva de "{item_name}"',
        "token": token,
    }


def _tool_propose_close_session(user_id, objetivo_text):
    from ..services.auth_service import _describe_user_agent
    obj = (objetivo_text or '').strip().lower()
    current_sid = get_jwt().get('sid')
    now = datetime.utcnow()
    tokens_q = (RefreshToken.query.filter_by(user_id=user_id, is_revoked=False)
                .filter(RefreshToken.expires_at > now).all())
    trusted = {d.device_id: d for d in TrustedDevice.query.filter_by(user_id=user_id).all()}

    def label_of(t):
        td = trusted.get(t.device_id) if t.device_id else None
        return (td.label if td and td.label else None) or _describe_user_agent(t.user_agent or '')

    if not tokens_q:
        return {"error": "No tienes sesiones activas."}

    if obj in ('actual', 'este', 'esta', 'este dispositivo', 'esta sesion', 'esta sesión', ''):
        current = next((t for t in tokens_q if current_sid and t.id == current_sid), None)
        if not current:
            return {"error": "No pude identificar cuál es tu sesión actual."}
        action = {"action": "cerrar_sesion", "user_id": str(user_id), "params": {"mode": "current", "session_id": current.id}}
        token = _action_serializer().dumps(action)
        return {"pending_confirmation": True, "resumen": "Cerrar la sesión de ESTE dispositivo (se cerrará tu sesión aquí mismo)", "token": token}

    if obj in ('todas', 'todos', 'todos los dispositivos', 'todas las sesiones', 'todo'):
        action = {"action": "cerrar_sesion", "user_id": str(user_id), "params": {"mode": "all"}}
        token = _action_serializer().dumps(action)
        return {"pending_confirmation": True, "resumen": f"Cerrar TODAS tus sesiones ({len(tokens_q)} dispositivo(s))", "token": token}

    matched = [t for t in tokens_q if obj in label_of(t).lower()]
    if not matched:
        listado = "; ".join(label_of(t) for t in tokens_q)
        return {"error": f"No encontré ningún dispositivo que coincida con \"{objetivo_text}\". Tus sesiones activas son: {listado}."}
    if len(matched) > 1:
        return {"error": f"Hay más de un dispositivo que coincide con \"{objetivo_text}\". Sé más específico."}
    t = matched[0]
    is_current = bool(current_sid and t.id == current_sid)
    action = {"action": "cerrar_sesion", "user_id": str(user_id), "params": {"mode": "current" if is_current else "one", "session_id": t.id}}
    token = _action_serializer().dumps(action)
    resumen = f'Cerrar la sesión de "{label_of(t)}"' + (" (¡es la sesión de ESTE dispositivo!)" if is_current else "")
    return {"pending_confirmation": True, "resumen": resumen, "token": token}


def get_query_keywords(text):
    stopwords = {'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'de', 'para', 'en', 'por', 'a', 'con', 'que', 'qué', 'como', 'cómo', 'cual', 'cuál', 'te', 'me', 'se', 'lo', 'al', 'del'}
    words = text.lower().translate(str.maketrans('', '', string.punctuation)).split()
    return " ".join([w for w in words if w not in stopwords and len(w) > 2])


# Palabras de saludo/relleno. Un mensaje se considera "saludo puro" SOLO si todas
# sus palabras están aquí (así "Hola, como puedo iniciar sesion" NO es un saludo).
GREETING_WORDS = {
    'hola', 'holaa', 'holaaa', 'holi', 'holis', 'ola', 'buenas', 'buenos',
    'dia', 'dias', 'día', 'días', 'tarde', 'tardes', 'noche', 'noches',
    'buen', 'buena', 'saludos', 'saludo', 'hey', 'ey', 'hi', 'hello',
    'que', 'qué', 'tal', 'como', 'cómo', 'estas', 'estás', 'esta', 'está',
    'va', 'todo', 'bien', 'y', 'sena', 'bot', 'asistente',
}
IDENTITY_QUESTIONS = {
    'quien eres', 'quién eres', 'que eres', 'qué eres',
    'como te llamas', 'cómo te llamas',
    'cual es tu nombre', 'cuál es tu nombre',
}


def classify_greeting(text):
    """Clasifica un mensaje: 'identity' (pregunta de identidad conocida),
    'greeting' (saludo puro: todas sus palabras son de saludo/relleno) o None."""
    q = (text or '').lower().translate(str.maketrans('', '', string.punctuation)).strip()
    if not q:
        return None
    if q in IDENTITY_QUESTIONS:
        return 'identity'
    words = q.split()
    if 0 < len(words) <= 6 and all(w in GREETING_WORDS for w in words):
        return 'greeting'
    return None


# Identificadores tipo código (snake_case en minúsculas) que a veces se filtran
# en la salida del modelo cuando intenta poner un icono, p.ej. 'borrow_tool',
# 'historiales_de_prestamos', 'personalized_settings'. NO afecta a [ESCALAR_SOPORTE]
# (mayúsculas) ni a TITULO: (sin guion bajo).
_LEAKED_TOKEN_RE = re.compile(r'(?<![`\w])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![`\w])')


def strip_leaked_tokens(text):
    """Quita identificadores tipo código filtrados y limpia las viñetas que
    queden vacías o con espacios sobrantes."""
    if not text:
        return text
    cleaned = _LEAKED_TOKEN_RE.sub('', text)
    cleaned = re.sub(r'^[ \t]*[-*][ \t]*$', '', cleaned, flags=re.MULTILINE)  # viñetas vacías
    cleaned = re.sub(r'[ \t]{2,}', ' ', cleaned)
    cleaned = re.sub(r'[ \t]+\n', '\n', cleaned)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)
    return cleaned.strip()


# Saludo/relleno al INICIO de una respuesta ("¡Hola! 👋", "¡Claro que sí,", ...).
# Solo se recorta en mensajes de seguimiento, donde no debe volver a saludar.
_LEADING_GREETING_RE = re.compile(
    r'^\s*(?:¡?\s*(?:hola(?:\s+de\s+nuevo)?|buen[oa]s(?:\s+(?:d[ií]as|tardes|noches))?'
    r'|claro(?:\s+que\s+s[ií])?|por\s+supuesto|con\s+(?:mucho\s+)?gusto|desde\s+luego'
    r'|perfecto|entendido)\s*[!¡,.\s\U0001F300-\U0001FAFF☀-➿]*)+',
    re.IGNORECASE,
)


def strip_leading_greeting(text):
    """Recorta un saludo inicial redundante en respuestas de seguimiento."""
    if not text:
        return text
    new = _LEADING_GREETING_RE.sub('', text, count=1).lstrip(" \n\t,;:!¡.-–—")
    if len(new) < 15:  # se comió casi todo: mejor dejarlo como estaba
        return text
    return new[0].upper() + new[1:]


# Nombres de cuentas de demostración / placeholder: el asistente NO debe dirigirse
# a la persona con estos "nombres"; usa el genérico "usuario".
_PLACEHOLDER_NAMES = {
    'test', 'test user', 'testuser', 'usuario test', 'usuario de prueba',
    'user test', 'demo', 'prueba', 'invitado', 'invitado sena', 'aprendiz',
}


def assistant_display_name(user, first_name_only=False):
    """Nombre con el que el asistente se dirige a la persona. Usa el apodo
    personal (display_name) si lo configuró — es exactamente para esto:
    cómo quiere que la app (y sus correos) le hable —, y si no, su nombre
    registrado. Para invitados o cuentas de prueba/demo devuelve 'usuario'
    (sin nombre propio)."""
    raw = ((getattr(user, 'display_name', '') if user else '') or (getattr(user, 'name', '') if user else '') or '').strip()
    email = ((getattr(user, 'email', '') if user else '') or '').strip().lower()
    if (not raw
            or raw.lower() in _PLACEHOLDER_NAMES
            or 'prueba' in raw.lower()
            or email.startswith('test@')
            or email.startswith('demo@')):
        return 'usuario'
    return raw.split()[0] if first_name_only else raw


def _dispatch_assistant_tool(fn_name, fn_args, user, user_role):
    """Ejecuta la función que Gemini decidió llamar y arma la respuesta que
    recibe el frontend. Las de solo lectura y 'navegar_a' se resuelven y
    redactan aquí mismo (determinístico, sin otra vuelta al modelo); las que
    cambian datos devuelven type=confirm_action con un token firmado — nunca
    se ejecutan en este paso."""
    user_id = str(user.id)

    if fn_name == 'listar_sesiones_activas':
        data = _tool_list_sessions(user_id)
        if not data['sesiones']:
            text = "No encontré ninguna sesión activa (esto no debería pasar mientras hablas conmigo, pero por si acaso)."
        else:
            lineas = []
            for s in data['sesiones']:
                marca = " — este dispositivo" if s['es_este_dispositivo'] else ""
                lineas.append(f"- **{s['dispositivo']}**{marca} · {s['ubicacion']} · desde {s['iniciada'] or '—'}")
            text = f"Tienes **{data['total']}** sesión(es) activa(s):\n\n" + "\n".join(lineas)
        return {"text": text, "type": "text", "source": "tool:listar_sesiones_activas"}

    if fn_name == 'listar_mis_prestamos':
        data = _tool_list_loans(user)
        if not data['prestamos']:
            text = "No tienes ningún préstamo activo en este momento."
        else:
            lineas = [f"- **{p['elemento']}** (código {p['codigo']}) · entregar antes de {p['entregar_antes_de'] or '—'} · {p['estado']}" for p in data['prestamos']]
            text = f"Tienes **{data['total']}** préstamo(s) activo(s):\n\n" + "\n".join(lineas)
        return {"text": text, "type": "text", "metadata": data['prestamos'] or None, "source": "tool:listar_mis_prestamos"}

    if fn_name == 'listar_mis_reservas':
        data = _tool_list_reservations(user_id)
        if not data['reservas']:
            text = "No tienes ninguna reserva activa en este momento."
        else:
            lineas = [f"- **{r['elemento']}** · {r['estado']}" + (f" · expira {r['expira']}" if r['expira'] else "") for r in data['reservas']]
            text = f"Tienes **{data['total']}** reserva(s) activa(s):\n\n" + "\n".join(lineas)
        return {"text": text, "type": "text", "source": "tool:listar_mis_reservas"}

    if fn_name == 'navegar_a':
        nav = _resolve_nav(user_role, fn_args.get('destino', ''))
        if not nav:
            text = f"No encontré una sección que coincida con \"{fn_args.get('destino', '')}\". Dime con otras palabras a dónde quieres ir."
            return {"text": text, "type": "text", "source": "tool:navegar_a"}
        text = f"Claro, aquí tienes el acceso directo a **{nav['label']}**:"
        return {"text": text, "type": "navigate", "route": nav['route'], "label": nav['label'], "source": "tool:navegar_a"}

    if fn_name == 'reservar_elemento':
        result = _tool_propose_reserve(user_id, fn_args.get('elemento', ''))
        if result.get('error'):
            return {"text": result['error'], "type": "text", "source": "tool:reservar_elemento"}
        text = f"{result['resumen']}. ¿Confirmas?"
        return {"text": text, "type": "confirm_action", "token": result['token'], "action_summary": result['resumen'], "source": "tool:reservar_elemento"}

    if fn_name == 'cancelar_mi_reserva':
        result = _tool_propose_cancel(user_id, fn_args.get('elemento', ''))
        if result.get('error'):
            return {"text": result['error'], "type": "text", "source": "tool:cancelar_mi_reserva"}
        text = f"{result['resumen']}. ¿Confirmas?"
        return {"text": text, "type": "confirm_action", "token": result['token'], "action_summary": result['resumen'], "source": "tool:cancelar_mi_reserva"}

    if fn_name == 'cerrar_sesion_dispositivo':
        result = _tool_propose_close_session(user_id, fn_args.get('objetivo', ''))
        if result.get('error'):
            return {"text": result['error'], "type": "text", "source": "tool:cerrar_sesion_dispositivo"}
        text = f"{result['resumen']}. ¿Confirmas?"
        return {"text": text, "type": "confirm_action", "token": result['token'], "action_summary": result['resumen'], "source": "tool:cerrar_sesion_dispositivo"}

    return {"text": "No reconocí esa acción. ¿Puedes reformularlo?", "type": "text", "source": "tool:unknown"}


@assistant_bp.route('/chat', methods=['POST'])
@jwt_required(optional=True)
def chat_ai():
    data = request.get_json() or {}
    user_query = data.get('message', '').strip()
    history = data.get('history', [])
    media = data.get('media')
    
    if not user_query:
        return jsonify({"error": "El mensaje no puede estar vacío"}), 400
        
    # --- SISTEMA DE CACHÉ BÁSICO ---
    # Solo cacheamos si no hay archivos adjuntos
    from flask import current_app
    import time
    
    cache_key = None
    if not media:
        cache_store = current_app.config.setdefault('BOT_CACHE', {})
        # Clave basada en la pregunta y cantidad de mensajes previos
        cache_key = f"cache_{user_query.strip().lower()}_{len(history)}"
        
        if cache_key in cache_store:
            cached_data, timestamp = cache_store[cache_key]
            if time.time() - timestamp < 300:  # 5 minutos de vigencia
                print(f"Sirviendo respuesta desde CACHÉ: {cache_key}")
                return jsonify(cached_data)
    # -------------------------------
        
    # 1. Obtener la identidad del usuario actual
    user_id = get_jwt_identity()
    user = None
    if user_id:
        user = User.query.filter_by(id=str(user_id)).first()
        
    user_name = assistant_display_name(user)

    # 1.b Obtener rol del usuario para personalizar instrucciones
    user_role = 'INVITADO'
    if user and user.role:
        user_role = (user.role.name or '').upper().strip() or 'USUARIO'

    # Capacidades por rol — la IA usará esto para guiar al usuario
    ROLE_CAPABILITIES = {
        'ADMIN': """ROL ACTUAL: ADMINISTRADOR (control total del sistema).
CAPACIDADES Y MENÚ DISPONIBLE:
- Gestión de Usuarios: crear, editar, cambiar rol, desactivar cuentas. Ubicación: menú lateral → "Usuarios". Botón "Nuevo usuario" arriba a la derecha.
- Gestión de Inventario: agregar/editar libros, herramientas, equipos. Crear categorías, ubicaciones. Menú → "Inventario".
- Préstamos: ver, crear y devolver préstamos de cualquier usuario. Menú → "Préstamos".
- Reservas: gestionar todas las reservas activas. Menú → "Reservas".
- Mantenimiento: revisar incidencias de elementos dañados. Menú → "Mantenimiento".
- Salidas controladas: autorizar salidas de equipos. Menú → "Salidas".
- Reportes estadísticos: ver gráficos y métricas. Menú → "Reportes".
- Auditoría: ver historial completo de acciones en el sistema. Menú → "Auditoría".
- Solicitudes: ver tickets escalados (pero solo Soporte puede aceptarlos).
- Configuración del sistema: parámetros globales. Menú → "Configuración".
PUEDES indicar al admin cómo realizar cualquier operación administrativa paso a paso. Eres su asistente con acceso total a la guía del sistema.""",

        'SOPORTE': """ROL ACTUAL: SOPORTE TÉCNICO.
CAPACIDADES Y MENÚ DISPONIBLE:
- Solicitudes: ver bandeja de tickets escalados por aprendices, aceptarlos y atenderlos por chat. Menú → "Solicitudes".
- Mantenimiento: registrar y resolver incidencias de equipos dañados. Menú → "Mantenimiento".
- Repuestos: gestionar solicitudes de repuestos.
- Chat interno: comunicación con Bibliotecario, Almacenista y Admin.
NO tienes acceso a: gestión de usuarios, inventario general, reportes ejecutivos.
Guía a Soporte a usar sus herramientas. No le sugieras tareas de admin.""",

        'BIBLIOTECARIO': """ROL ACTUAL: BIBLIOTECARIO.
CAPACIDADES Y MENÚ DISPONIBLE:
- Gestión de libros: agregar, editar, ver disponibilidad. Menú → "Libros".
- Préstamos de libros: registrar entregas y devoluciones. Menú → "Préstamos".
- Reservas de libros: gestionar apartados de la biblioteca.
- Chat interno con otros funcionarios.
NO tienes acceso a: gestión de usuarios, herramientas/equipos del almacén, reportes administrativos.
Guía al bibliotecario en sus tareas específicas de biblioteca.""",

        'ALMACENISTA': """ROL ACTUAL: ALMACENISTA.
CAPACIDADES Y MENÚ DISPONIBLE:
- Gestión de herramientas y equipos del almacén: agregar, editar, ver stock. Menú → "Almacén".
- Préstamos de equipos: registrar entregas y devoluciones de herramientas.
- Reservas de equipos: gestionar apartados.
- Salidas controladas: registrar salidas autorizadas de equipos.
- Chat interno con otros funcionarios.
NO tienes acceso a: gestión de usuarios, libros, reportes administrativos.
Guía al almacenista en sus tareas específicas del almacén.""",

        'INSTRUCTOR': """ROL ACTUAL: INSTRUCTOR.
CAPACIDADES Y MENÚ DISPONIBLE:
- Explorar el catálogo y solicitar préstamos de libros y equipos.
- Ver sus préstamos activos y reservas.
- Autorizar préstamos de herramientas pesadas a sus aprendices (firma).
NO tienes acceso a: gestión de usuarios, modificar inventario, reportes administrativos, eliminar cuentas.
Guía al instructor en consultas y solicitudes.""",

        'APRENDIZ': """ROL ACTUAL: APRENDIZ.
CAPACIDADES Y MENÚ DISPONIBLE:
- Explorar el catálogo: libros y herramientas disponibles.
- Reservar elementos (15 minutos para retirar).
- Ver sus préstamos activos y fechas de devolución.
- Ver sus reservas pendientes.
- Ver su historial de movimientos.
- Asistente personal (este chat).
- Configurar su perfil.
- Escalar conversaciones al equipo de Soporte si la IA no resuelve.
NO tienes acceso a: gestión de usuarios, modificar inventario, ver préstamos de otros, reportes administrativos, eliminar usuarios, auditoría.
IMPORTANTE: Si el aprendiz pide algo fuera de sus permisos (eliminar usuario, modificar inventario, ver préstamos de terceros, acceder a reportes administrativos), explícale amablemente que esas acciones son exclusivas del personal autorizado y NO le sugieras formas de saltarse la restricción.""",

        'USUARIO': """ROL ACTUAL: USUARIO (similar a Aprendiz).
CAPACIDADES Y MENÚ DISPONIBLE:
- Explorar el catálogo.
- Reservar elementos.
- Ver sus préstamos y reservas.
- Asistente personal.
- Configurar su perfil.
NO tienes acceso a: gestión administrativa de ningún tipo.
Si pide acciones administrativas, indica que necesita un rol con esos permisos.""",

        'PROVEEDOR': """ROL ACTUAL: PROVEEDOR.
CAPACIDADES: ver órdenes de suministro y entregas pendientes.
Guía al proveedor en su flujo específico.""",

        'INVITADO': """ROL ACTUAL: INVITADO (sin sesión iniciada).
CAPACIDADES LIMITADAS:
- Solo puede explorar el catálogo en modo lectura.
- No puede reservar, prestar, ni ver datos personales.
- Para hacer cualquier acción debe iniciar sesión o registrarse.
Sugiérele iniciar sesión cuando pida algo restringido.""",
    }
    role_caps = ROLE_CAPABILITIES.get(user_role, ROLE_CAPABILITIES['USUARIO'])

    # 2. RAG: Obtener información de Préstamos Activos
    user_loans_text = "No tienes préstamos activos actualmente."
    active_loans_list = []
    if user:
        loans = Loan.query.filter_by(user_id=str(user.id)).filter(Loan.status.in_(['ACTIVE', 'OVERDUE'])).all()
        if loans:
            user_loans_text = "Tienes los siguientes préstamos activos en el sistema:\n"
            for l in loans:
                for detail in l.details:
                    due_str = l.due_date.strftime('%Y-%m-%d %H:%M') if l.due_date else 'N/A'
                    user_loans_text += f"- Elemento: {detail.item.name} | Código: {detail.item.code} | Entregar antes de: {due_str} | Estado: {l.status}\n"
                    active_loans_list.append({
                        "id": detail.item.id,
                        "name": detail.item.name,
                        "code": detail.item.code,
                        "due_date": due_str,
                        "status": l.status
                    })

    # 3. RAG: Obtener catálogo de elementos relevantes según la pregunta
    inventory_context = ""
    keywords = [w.lower() for w in user_query.split() if len(w) > 3]
    relevant_items = []
    
    # Buscar elementos que coincidan por nombre o descripción
    if keywords:
        all_items = Item.query.all()
        for item in all_items:
            item_name_lower = item.name.lower() if item.name else ''
            item_desc_lower = item.description.lower() if item.description else ''
            if any(k in item_name_lower or k in item_desc_lower for k in keywords):
                relevant_items.append(item)
                
    # Si no hay coincidencias directas, jalar los 15 primeros elementos del catálogo como contexto básico
    if not relevant_items:
        relevant_items = Item.query.limit(15).all()
        
    if relevant_items:
        inventory_context = "A continuación, se listan los elementos relevantes que coinciden con tu inventario:\n"
        for item in relevant_items:
            cat_name = item.category.name if item.category else 'General'
            status_name = item.status_obj.name if item.status_obj else 'AVAILABLE'
            inventory_context += f"- {item.name} (Categoría: {cat_name}) | Código/ISBN: {item.code} | Stock: {item.stock} | Estado: {status_name}\n"
    else:
        inventory_context = "No se encontraron elementos disponibles en el catálogo en este momento."

    # 4. Construir System Instructions
    system_instruction = f"""
Eres SENA Bot, el asistente virtual inteligente oficial de la Biblioteca y Almacén del Centro de Formación SENA Sede Vélez, Santander.

DESCRIPCIÓN GLOBAL DEL SISTEMA Y CONTEXTO:
Eres la inteligencia artificial integrada en un sistema web moderno para la gestión de inventario, biblioteca y control de activos del SENA. Este sistema soluciona problemas previos de desorganización y falta de trazabilidad.
- Funcionalidades clave: Inventario inteligente (identificación única QR/Código), control preciso de estados y ubicaciones, reservas en tiempo real (que se liberan tras un tiempo límite), sistema avanzado de préstamos con historial y penalizaciones, notificaciones, módulo de mantenimiento para daños, y control de salidas de la sede.
- Seguridad y Trazabilidad: Autenticación por roles (JWT), historial completo de movimientos (auditoría), y paneles administrativos estadísticos para toma de decisiones.
- Roles en el sistema: Aprendiz e Instructor (consultan y piden préstamos), Bibliotecario (libros), Almacenista (herramientas/equipos), Soporte técnico (reparaciones), Administrador (control total) y Proveedor.

GUÍA DE NAVEGACIÓN DE LA PLATAFORMA (Menú Lateral):
- "Inicio": Resumen general del sistema.
- "Explorar elementos": Catálogo completo para buscar y reservar libros, herramientas y equipos.
- "Mis préstamos": Ver los elementos que tienes actualmente y sus fechas de devolución.
- "Mis reservas": Ver los elementos apartados pendientes por recoger.
- "Historial": Registro de todos tus movimientos pasados.
- "Asistente personal": Este chat donde estamos hablando.
- "Notificaciones": Alertas sobre retrasos, confirmaciones, etc.
- "Configuración": Contiene un panel avanzado con las siguientes pestañas:
  * "Información personal" (editar nombres, documento, foto de perfil, biografía).
  * "Correo electrónico" (cambiar y verificar correo).
  * "Cambiar contraseña".
  * "Autenticación en dos pasos" (configurar 2FA con App o SMS).
  * "Sesiones activas" (ver IPs y cerrar sesiones remotas).
  * "Preferencias de notificaciones" y "Alertas y recordatorios" (modo silencio).
  * "Privacidad y datos" (descargar datos en JSON).
  * "Historial de accesos" (registro de inicios de sesión y bloqueos).
  * "Eliminar cuenta" (opción para borrar cuenta permanentemente escribiendo una frase de confirmación).
- "Perfil": Haciendo clic en el ícono del lápiz sobre tu avatar (abajo a la izquierda) accedes a Configuración rápida.

INFORMACIÓN EN TIEMPO REAL DEL USUARIO (RAG):
- Nombre del Usuario: {user_name}  (si es "usuario", NO tienes su nombre real: dirígete a la persona de forma amable sin inventar ni forzar un nombre propio)
- Estado de autenticación: {'Iniciado sesión' if user else 'Invitado'}
- Rol del usuario: {user_role}
- Préstamos activos del usuario:
  {user_loans_text}

═══════════════════════════════════════════════
CAPACIDADES Y PERMISOS DEL ROL ACTUAL
═══════════════════════════════════════════════
{role_caps}
═══════════════════════════════════════════════

INFORMACIÓN EN TIEMPO REAL DEL CATÁLOGO DE INVENTARIO (RAG):
{inventory_context}

POLÍTICAS Y NORMAS DEL SENA:
- Horarios de atención: Lunes a Viernes de 6:00 AM a 10:00 PM. Sábados, domingos y festivos cerrado.
- Reglamento de Libros: Préstamo de libros de biblioteca estándar de 8 días calendario, renovable. Debes presentarte con tu carnet físico o cédula. Si reservas, tienes hasta 15 minutos para retirar el elemento en ventanilla.
- Reglamento de Almacén de Herramientas/Equipos: Préstamo estándar por 3 días hábiles. Se requiere presentar tu documento y carnet, y para herramientas pesadas se requiere firma de autorización de tu instructor de taller.
- Sanciones por demoras: Suspensión de préstamo por 1 día por cada día de retraso de cada elemento.
- Pérdida o daños: Plazo máximo de 15 días hábiles para reponer el artículo por uno exactamente igual (marca y modelo) o superior. Mientras tanto, la cuenta de préstamos queda bloqueada.
- Ubicación de la Sede Vélez:
  * Biblioteca: Bloque Principal, primer piso junto al área administrativa.
  * Almacén de Equipos: Al fondo del pasillo técnico, contiguo a los talleres de electricidad y automatización.

INSTRUCCIONES DE RESPUESTA:
1. Responde siempre en español, con un tono motivador, empático, amigable, claro y profesional (como un consejero tecnológico del SENA).
2. IDENTIDAD: te llamas **SENA Bot**. Si preguntan quién eres, cómo te llamas o qué eres, responde SIEMPRE que eres "SENA Bot", el asistente virtual oficial de la Biblioteca y Almacén del SENA — Sede Vélez, Santander. NUNCA te presentes como "tu asistente personal" ni con otro nombre.
3. NO SALUDES EN CADA MENSAJE. Di "¡Hola!" y preséntate SOLO en el primer mensaje de una conversación nueva. En los mensajes siguientes ve directo a la respuesta: nada de "¡Hola!", "¡Claro que sí!", ni repetir la bienvenida o el aviso de "usuario Invitado" si ya lo dijiste antes.
4. FORMATO: usa negritas, listas y emojis Unicode reales escritos directamente (📚 📅 🔧 🕒 ⚙️ ✅ 🔒). QUEDA PROHIBIDO escribir identificadores de código, nombres de función o texto en snake_case como `borrow_tool`, `historiales_de_prestamos`, `personalized_settings` o similares. Si quieres un icono, escribe el emoji, nunca su nombre. La única excepción son las etiquetas especiales que se te pidan explícitamente (TITULO:, [ESCALAR_SOPORTE]).
5. CRÍTICO — RESPETA EL ROL: Antes de responder cualquier pregunta sobre acciones del sistema (crear/editar/eliminar usuarios, modificar inventario, ver reportes, etc.), REVISA las CAPACIDADES Y PERMISOS DEL ROL ACTUAL arriba.
   - Si la acción ESTÁ permitida para este rol: guía paso a paso (dónde está en el menú, qué botón presionar, qué campos llenar). Eres un asistente con acceso total a esa función.
   - Si la acción NO está permitida para este rol: explícalo amablemente y sugiere a quién pedírselo o si necesita escalar a soporte. NUNCA expliques cómo saltarse la restricción.
   - EJEMPLO: si un ADMIN pregunta "cómo agrego un usuario", debes explicarle exactamente que vaya a Menú → Usuarios → botón "Nuevo usuario". NO le digas "no tengo permisos" — ese rol SÍ puede hacerlo.
   - EJEMPLO: si un APRENDIZ pregunta "cómo elimino a otro usuario", debes responder que esa acción está reservada al administrador del sistema.
6. Si el usuario te pregunta sobre la disponibilidad de un artículo, revisa la "INFORMACIÓN EN TIEMPO REAL DEL CATÁLOGO" y responde con exactitud (stock, código).
7. Si el usuario pregunta por sus préstamos, revisa la sección de préstamos arriba.
8. Mantén tus respuestas concisas pero completas. No inventes elementos del catálogo.
9. Si la consulta es completamente fuera del sistema SENA (matemáticas, vida personal, otros temas), termina tu respuesta con la línea exacta: [ESCALAR_SOPORTE]
10. ACCIONES: si tienes funciones disponibles (listar_sesiones_activas, listar_mis_prestamos, listar_mis_reservas, navegar_a, reservar_elemento, cancelar_mi_reserva, cerrar_sesion_dispositivo), y el usuario pide EXPLÍCITAMENTE hacer o ver algo que una de ellas resuelve ("dame mis sesiones", "resérvame X", "cancela mi reserva de X", "llévame a configuración", "cierra esta sesión"), LLAMA a la función correspondiente en vez de solo explicar los pasos por texto. Si falta un dato para llamarla (por ejemplo qué elemento reservar), pregúntalo primero. Nunca inventes que ya ejecutaste una acción: solo las funciones de reservar/cancelar/cerrar sesión pueden hacerlo, y el sistema le pedirá confirmación al usuario antes de aplicarlas.
"""

    # Si es una conversación nueva (historial vacío), pedir que genere título
    valid_history_messages = [m for m in history if m.get("role") == "user"]
    if len(valid_history_messages) == 0:
        system_instruction += "\n\nREGLA ADICIONAL: Como este es el primer mensaje de la conversación, DEBES iniciar tu respuesta exactamente con la palabra 'TITULO: ' seguida de un breve resumen de máximo 4 a 5 palabras del tema consultado, luego haz un salto de línea y continúa con tu respuesta normal. Después del título puedes saludar UNA vez y presentarte brevemente como SENA Bot."
    else:
        system_instruction += "\n\nREGLA ADICIONAL: Esta conversación YA está en curso. NO saludes, NO te presentes de nuevo y NO repitas la bienvenida ni el aviso de 'usuario Invitado'. Responde directamente a la última pregunta del usuario, breve y al grano."

    q_lower = user_query.lower()

    # 4.4 INTENCIÓN EXPLÍCITA: el usuario pide hablar con soporte/humano
    # Detectamos esto ANTES de llamar a la IA propia o Gemini — no tiene sentido
    # gastar tokens si lo que quiere es escalar.
    SUPPORT_REQUEST_KEYWORDS = [
        'quiero soporte', 'quiero hablar con soporte', 'contactar soporte',
        'contactar a soporte', 'hablar con soporte', 'necesito soporte',
        'solicitar soporte', 'solicitar a un soporte', 'solicitar un soporte',
        'hablar con un humano', 'hablar con una persona', 'necesito ayuda humana',
        'atención humana', 'atencion humana', 'crear ticket', 'abrir ticket',
        'reportar problema', 'reportar un problema'
    ]
    if any(k in q_lower for k in SUPPORT_REQUEST_KEYWORDS):
        role_up = ''
        if user and user.role:
            role_up = (user.role.name or '').upper().strip()
        can_escalate_now = role_up in ESCALATABLE_ROLES

        if can_escalate_now:
            return jsonify({
                "text": "Entendido. Puedo crear una solicitud al equipo de Soporte para que te atiendan en este mismo chat.",
                "type": "text",
                "suggest_support": True,
                "source": "intent-support",
            })
        elif not user:
            return jsonify({
                "text": "Para contactar al equipo de Soporte necesitas iniciar sesión primero. Una vez dentro, vuelve a pedírmelo y te crearé la solicitud.",
                "type": "text",
                "source": "intent-support-guest",
            })
        elif 'SOPORTE' in role_up:
            return jsonify({
                "text": f"Hola **{user_name}**, ¡tú eres parte del equipo de Soporte! 😊 No tiene sentido que escales un ticket a ti mismo. Si necesitas atender solicitudes pendientes, ve al menú lateral → **Solicitudes**. Si necesitas hablar con un Administrador, contáctalo por el chat interno de staff.",
                "type": "text",
                "source": "intent-support-isstaff",
            })
        elif role_up == 'ADMIN':
            return jsonify({
                "text": f"Hola **{user_name}**, como **Administrador** tienes acceso total al sistema. No requieres escalar tickets a Soporte. Si necesitas revisar tickets activos, ve a **Solicitudes** en el menú lateral.",
                "type": "text",
                "source": "intent-support-isadmin",
            })
        else:
            return jsonify({
                "text": f"Tu rol (**{role_up.capitalize()}**) no tiene habilitada la escalación a Soporte desde este chat. Para asistencia, dirígete al área correspondiente del SENA.",
                "type": "text",
                "source": "intent-support-norole",
            })

    # ── IDENTIDAD ────────────────────────────────────────────────────────────
    # "¿Quién eres?" SÍ se responde siempre igual, de forma determinista: es un
    # hecho (el nombre del bot), no algo que deba variar entre respuestas.
    # Un simple "hola"/"buenos días" ya NO tiene una respuesta enlatada fija:
    # sigue el flujo normal (IA propia si aplica, si no Gemini) para que se
    # sienta natural y no repita siempre el mismo texto.
    greeting_kind = classify_greeting(user_query)
    if greeting_kind == 'identity' and not media:
        CAPS = (
            "- 📚 **Catálogo** — libros, herramientas y equipos disponibles.\n"
            "- 📅 **Préstamos y reservas** — cómo solicitarlos y consultar los tuyos.\n"
            "- 🕒 **Horarios, ubicaciones y reglamento** de la sede.\n"
            "- ⚙️ **Tu cuenta** — perfil, contraseña, notificaciones y seguridad."
        )
        text = ("Soy **SENA Bot** 🤖, el asistente virtual oficial de la Biblioteca y Almacén "
                "del SENA — Sede Vélez, Santander. Puedo ayudarte con:\n\n" + CAPS + "\n\n¿Con qué empezamos?")
        return jsonify({"text": text, "type": "text", "source": "own-ai-greeting-short"})

    # 4.5 PRIORIDAD: consultar primero la IA propia (AILearnedResponse).
    # SOLO si es el PRIMER mensaje (sin historial) y no hay multimedia ni RAG dinámico.
    # Razón: los mensajes de seguimiento ("es de manera educativa", "sí", "no", etc.)
    # solo tienen sentido en el contexto de la conversación previa, y la IA propia
    # busca por keywords sin contexto — devolvería respuestas absurdas.
    RAG_TRIGGERS = ['mis prestamos', 'mis préstamos', 'mi prestamo', 'mi préstamo',
                    'cuanto debo', 'cuánto debo', 'tengo prestamo', 'tengo préstamo',
                    'stock', 'disponible', 'disponibilidad', 'cuantos hay', 'cuántos hay',
                    'tengo multa', 'tengo sancion', 'tengo sanción']
    # Frases que piden EJECUTAR una acción (reservar, cancelar, cerrar sesión,
    # navegar, ver mis sesiones/reservas). Estas SIEMPRE deben llegar a Gemini
    # en vivo — la IA propia solo devuelve texto aprendido y jamás podría
    # invocar una función real, así que si dejáramos pasar una de estas frases
    # por el atajo de abajo, el usuario nunca llegaría a ver el botón de
    # confirmación (se quedaría con una respuesta de texto genérica aprendida).
    ACTION_TRIGGERS = ['reserva', 'reservar', 'resérvame', 'reservame',
                       'cancela', 'cancelar', 'cancélame', 'cancelame',
                       'cerrar sesion', 'cerrar sesión', 'cierra sesion', 'cierra sesión',
                       'mis sesiones', 'sesiones activas', 'dispositivos conectados',
                       'llevame', 'llévame', 'navega', 'navegar', 'ir a', 'abre',
                       'abreme', 'ábreme']
    needs_fresh_data = any(t in q_lower for t in RAG_TRIGGERS) or any(t in q_lower for t in ACTION_TRIGGERS)
    has_conversation_history = len([m for m in history if m.get("role") == "user"]) > 0

    if not media and not needs_fresh_data and not has_conversation_history:
        try:
            # Búsqueda general por keywords
            user_kws = get_query_keywords(user_query)
            if len(user_kws) > 5:
                words = user_kws.split()
                query_word_set = set(words)
                if words:
                    search_filter = AILearnedResponse.query_keywords.ilike(f"%{words[0]}%")
                    for w in words[1:]:
                        search_filter = db.and_(search_filter, AILearnedResponse.query_keywords.ilike(f"%{w}%"))

                    # Solo respuestas VIGENTES (no vencidas) y de un ROL compatible
                    # (el mismo rol de quien la originó, o sin rol = genérica para
                    # cualquiera). Esto evita que, por ejemplo, un Aprendiz reciba
                    # una guía que en realidad era para un Administrador.
                    cutoff = datetime.utcnow() - timedelta(days=LEARNED_RESPONSE_TTL_DAYS)
                    search_filter = db.and_(
                        search_filter,
                        db.or_(AILearnedResponse.role == user_role, AILearnedResponse.role.is_(None)),
                        db.or_(AILearnedResponse.updated_at >= cutoff, AILearnedResponse.updated_at.is_(None)),
                    )

                    candidates = (AILearnedResponse.query.filter(search_filter)
                                  .order_by(AILearnedResponse.use_count.desc()).limit(5).all())

                    # Umbral de confianza: entre los candidatos que ya cumplen el
                    # AND de palabras, se elige el más parecido de verdad (Jaccard
                    # entre las palabras de la pregunta y las de la entrada
                    # guardada), no solo "el primero que matcheó todo".
                    learned, best_score = None, 0.0
                    for c in candidates:
                        stored_words = set((c.query_keywords or '').split())
                        if not stored_words:
                            continue
                        overlap = len(query_word_set & stored_words) / len(query_word_set | stored_words)
                        if overlap > best_score:
                            best_score, learned = overlap, c

                    if learned and best_score >= MIN_MATCH_CONFIDENCE:
                        learned.use_count += 1
                        db.session.commit()
                        print(f"[IA-PROPIA] Respuesta servida desde BD (uso #{learned.use_count}, confianza {best_score:.2f})")
                        return jsonify({
                            "text": learned.response_text,
                            "type": "text",
                            "source": "own-ai",
                            "learned_id": learned.id,
                        })
        except Exception as e:
            print(f"[IA-PROPIA] Error buscando en BD: {e}")
            db.session.rollback()

    # 5. Intentar llamar a Gemini API de Google usando REST API
    # Cadena de modelos: intenta el primero, si da 429 (cuota agotada) cae al siguiente.
    api_key = os.environ.get('GEMINI_API_KEY')
    GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']

    if not api_key:
        print("[GEMINI] GEMINI_API_KEY no configurada en el entorno — usando fallback rule-based")

    if api_key:
        # Construir contents una sola vez (compartido entre intentos)
        contents = []
        for msg in history[-10:]:
            role = "user" if msg.get("role") == "user" else "model"
            if "¡Hola" in msg.get("text", "") and role == "model":
                continue
            if contents and contents[-1]["role"] == role:
                contents[-1]["parts"][0]["text"] += "\n" + msg.get("text", "")
            else:
                contents.append({"role": role, "parts": [{"text": msg.get("text", "")}]})

        user_parts = [{"text": user_query}]
        if media and media.get("data") and media.get("mimeType"):
            user_parts.append({
                "inline_data": {
                    "mime_type": media.get("mimeType"),
                    "data": media.get("data")
                }
            })

        if contents and contents[-1]["role"] == "user":
            contents[-1]["parts"].extend(user_parts)
        else:
            contents.append({"role": "user", "parts": user_parts})

        payload = {
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "contents": contents
        }
        # Las acciones automatizadas (reservar, cancelar, sesiones, navegar) solo se
        # ofrecen a usuarios con sesión iniciada — un invitado no tiene datos propios
        # que listar ni permiso para reservar/cancelar/cerrar sesiones.
        if user:
            payload["tools"] = _build_assistant_tools()
        headers = {"Content-Type": "application/json"}

        last_error = None
        for model in GEMINI_MODELS:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                response = requests.post(url, json=payload, headers=headers, timeout=20)

                if response.status_code == 200:
                    res_data = response.json()
                    part0 = res_data['candidates'][0]['content']['parts'][0]

                    # ── El modelo decidió llamar a una función en vez de responder texto ──
                    function_call = part0.get('functionCall')
                    if function_call and user:
                        fn_name = function_call.get('name')
                        fn_args = function_call.get('args') or {}
                        print(f"[GEMINI TOOL] {fn_name}({fn_args})")
                        tool_json = _dispatch_assistant_tool(fn_name, fn_args, user, user_role)
                        if cache_key:
                            # Las acciones nunca se cachean: dependen del estado en vivo.
                            cache_store.pop(cache_key, None)
                        return jsonify(tool_json)

                    bot_text = part0.get('text', '')
                    print(f"[GEMINI OK] modelo={model}")

                    title = None
                    if bot_text.startswith("TITULO:"):
                        parts_text = bot_text.split('\n', 1)
                        title = parts_text[0].replace("TITULO:", "").strip()
                        bot_text = parts_text[1].strip() if len(parts_text) > 1 else bot_text

                    # Detectar si Gemini indica que no puede ayudar
                    gemini_suggest_support = False
                    if '[ESCALAR_SOPORTE]' in bot_text:
                        bot_text = bot_text.replace('[ESCALAR_SOPORTE]', '').strip()
                        if user and user.role:
                            role_up = (user.role.name or '').upper().strip()
                            gemini_suggest_support = role_up in ESCALATABLE_ROLES

                    # Red de seguridad: quitar identificadores tipo código filtrados
                    bot_text = strip_leaked_tokens(bot_text)
                    # En mensajes de seguimiento, quitar el saludo inicial redundante
                    if has_conversation_history:
                        bot_text = strip_leading_greeting(bot_text)

                    json_response = {
                        "text": bot_text,
                        "type": "text",
                        "title": title,
                        "metadata": active_loans_list if active_loans_list else None,
                        "source": "gemini",
                        "model": model,
                        "suggest_support": gemini_suggest_support,
                    }

                    if cache_key:
                        cache_store[cache_key] = (json_response, time.time())

                    # APRENDER: guardar la respuesta de Gemini para el modo offline futuro.
                    # Los saludos NUNCA se aprenden aquí: se responden de forma determinista
                    # más arriba y nunca llegan a este punto, así que no tiene sentido
                    # cachear un "hola".
                    try:
                        kws = get_query_keywords(user_query)
                        if (
                            classify_greeting(user_query) is None
                            and len(bot_text) > 15
                            and len(kws) > 5
                        ):
                            # Se busca por las mismas palabras clave Y el mismo rol:
                            # así, si dos roles distintos llegan a generar exactamente
                            # las mismas keywords, cada uno mantiene su propia entrada
                            # en vez de pisar la del otro.
                            existing = AILearnedResponse.query.filter_by(query_keywords=kws, role=user_role).first()
                            if existing:
                                existing.response_text = bot_text
                                existing.use_count += 1
                                existing.updated_at = datetime.utcnow()
                            else:
                                db.session.add(AILearnedResponse(
                                    query_text=user_query,
                                    query_keywords=kws,
                                    response_text=bot_text,
                                    role=user_role,
                                    source='gemini',
                                ))
                            db.session.commit()
                    except Exception as db_e:
                        db.session.rollback()
                        print("Error guardando conocimiento IA:", db_e)

                    return jsonify(json_response)

                elif response.status_code == 429:
                    print(f"[GEMINI 429] cuota agotada en {model}, probando siguiente modelo...")
                    last_error = f"429 en {model}"
                    continue
                else:
                    print(f"[GEMINI ERROR] modelo={model} status={response.status_code} body={response.text[:300]}")
                    last_error = f"{response.status_code} en {model}"
                    break  # error no recuperable, no probar mas modelos
            except Exception as e:
                print(f"[GEMINI EXC] modelo={model}: {e}")
                last_error = str(e)
                continue

        print(f"[GEMINI] todos los modelos fallaron, cayendo a fallback local. Ultimo error: {last_error}")

    # 6. Fallback Rule-Based Inteligente con RAG (Si no hay API key o falló la llamada)
    fallback_text = ""
    suggest_support = False  # Se activa cuando la IA no puede ayudar y el usuario es aprendiz
    q = user_query.lower()

    # Determinar si el usuario actual puede escalar a soporte
    # Roles permitidos: APRENDIZ, USUARIO, ALMACENISTA, BIBLIOTECARIO
    # (INVITADO también pero requiere login primero — el frontend lo gestiona)
    can_escalate = False
    if user and user.role:
        role_name_upper = (user.role.name or '').upper().strip()
        can_escalate = role_name_upper in ESCALATABLE_ROLES
    
    # Nota: la búsqueda en AILearnedResponse ya se hizo arriba (paso 4.5) con prioridad.
    # Si llegamos aquí es porque no había respuesta aprendida o necesitaba datos frescos
    # y Gemini también falló. Solo nos queda el rule-based básico.

    # CATEGORÍA 0: Navegar a una sección conocida (ACCIÓN — sin Gemini)
    # Va PRIMERO en la cadena a propósito: el destino puede mencionar
    # cualquier palabra de dominio ("préstamos", "reservas", "sesiones"...)
    # que de otro modo activaría una categoría genérica más abajo antes de
    # llegar aquí. Solo dispara con frases explícitas de "llévame/navega/ir
    # a ..."; _resolve_nav ya sabe responder "no encontré esa sección" si no
    # reconoce nada razonable, así que no hay riesgo de un enlace inventado.
    if user and re.search(r'(ll[eé]vame a|navega(r)? a|ir a|[aá]breme)\b', q):
        destino = re.sub(r'.*?(ll[eé]vame a|navega(r)? a|ir a|[aá]breme)\b', '', q, count=1).strip(' ?!.')
        return jsonify(_dispatch_assistant_tool('navegar_a', {'destino': destino}, user, user_role))

    # CATEGORÍA 1: Saludos, Presentación y Ayuda General
    elif any(k in q for k in ['hola', 'saludos', 'buenos dias', 'buenas tardes', 'buen dia', 'buena tarde', 'que tal', 'como estas', 'quien eres', 'quién eres', 'ayuda', 'asistente', 'sena bot']):
        fallback_text = f"Puedo ayudarte con reservas, préstamos, horarios, ubicaciones y configuración de la plataforma. ¿Con qué necesitas ayuda?"

    # CATEGORÍA 2: Préstamos y deudas (RAG en tiempo real)
    elif any(k in q for k in ['prestamo', 'préstamo', 'tengo prestado', 'mis herramientas', 'mis libros', 'mis prestamos', 'mis deudas', 'debo', 'entregar']):
        if not user:
            fallback_text = "Actualmente estás navegando como **Usuario Invitado**, por lo que no posees préstamos activos asignados. 🔒 ¡Inicia sesión para poder solicitar materiales!"
        elif not active_loans_list:
            fallback_text = f"Revisé el sistema de registros y no tienes ningún préstamo activo asignado actualmente. 📚 ¡Sigue explorando nuestro catálogo para solicitar herramientas, equipos o libros!"
        else:
            fallback_text = f"Actualmente tienes **{len(active_loans_list)} préstamo(s) activo(s)** bajo tu custodia:\n\n"
            for item in active_loans_list:
                status_emoji = "⚠️" if item['status'] == 'OVERDUE' else "📦"
                fallback_text += f"{status_emoji} **{item['name']}** | Entregar antes del **{item['due_date']}**\n"

    # CATEGORÍA 2B: Sesiones activas / dispositivos conectados (ACCIÓN — sin Gemini)
    # Estas no necesitan "adivinar" ningún parámetro libre (no hay nombre de
    # elemento que identificar), así que es seguro ejecutarlas también desde
    # el sistema de reglas, sin depender de que Gemini esté disponible.
    elif user and any(k in q for k in ['sesion activa', 'sesión activa', 'sesiones activas',
                                        'mis sesiones', 'mis dispositivos', 'dispositivos conectados',
                                        'dispositivo conectado', 'donde tengo sesion', 'dónde tengo sesión']):
        return jsonify(_dispatch_assistant_tool('listar_sesiones_activas', {}, user, user_role))

    # CATEGORÍA 2C: Cerrar sesión / dispositivo (ACCIÓN — sin Gemini, con confirmación)
    elif user and any(k in q for k in ['cerrar sesion', 'cerrar sesión', 'cierra sesion', 'cierra la sesion',
                                        'cierra la sesión', 'cierra mi sesion', 'cierra mi sesión',
                                        'cerrar mi sesion', 'cerrar mi sesión', 'cerrar dispositivo',
                                        'cerrar todas mis sesiones', 'salir de todos los dispositivos']):
        objetivo = 'todas' if any(k in q for k in ['todas', 'todos', 'todo']) else 'actual'
        return jsonify(_dispatch_assistant_tool('cerrar_sesion_dispositivo', {'objetivo': objetivo}, user, user_role))

    # CATEGORÍA 3B: Mis reservas — datos reales (ACCIÓN — sin Gemini)
    # Distinto de la CATEGORÍA 3 (guía genérica de "cómo reservo"): aquí el
    # usuario pregunta explícitamente por SUS reservas, así que respondemos
    # con datos reales en vez de instrucciones.
    elif user and any(k in q for k in ['mis reservas', 'mi reserva', 'tengo reservas', 'tengo una reserva',
                                        'reservas activas', 'estado de mi reserva', 'estado de mis reservas']):
        return jsonify(_dispatch_assistant_tool('listar_mis_reservas', {}, user, user_role))

    # CATEGORÍA 3: Reservas y apartados (Límite de 15 min)
    elif any(k in q for k in ['reserva', 'reservar', 'apartar', 'separar', 'agendar', 'guardar', 'rentar']):
        fallback_text = f"📅 **Guía de Reservas en la Plataforma:**\n\n" \
                        "Para asegurar cualquier elemento de la biblioteca o del almacén antes de recogerlo, haz lo siguiente:\n" \
                        "1. 🔍 Ve al apartado **'Explorar elementos'** en tu menú lateral izquierdo.\n" \
                        "2. 📄 Busca el libro o la herramienta que necesites y haz clic para ver sus detalles.\n" \
                        "3. ⚡ Si está disponible (Stock > 0), haz clic en el botón **'Reservar'**.\n\n" \
                        "⚠️ **REGLA DE ORO (15 MINUTOS):** Una vez que realices la reserva, cuentas con un plazo máximo de **15 minutos** para retirarlo físicamente en la ventanilla con el encargado. Si no te presentas en ese tiempo, la reserva expirará y se liberará de inmediato para otros compañeros."

    # CATEGORÍA 4: Eliminación de Cuenta y Privacidad
    elif any(k in q for k in ['eliminar cuenta', 'borrar cuenta', 'eliminar mi cuenta', 'borrar mi cuenta', 'desactivar cuenta', 'privacidad', 'datos', 'descargar datos']):
        fallback_text = f"⚙️ **Procedimiento de Eliminación de Cuenta y Privacidad:**\n\n" \
                        "La plataforma respeta las leyes de privacidad de datos. Si deseas eliminar tu cuenta permanentemente:\n" \
                        "1. ⚙️ Dirígete al menú lateral izquierdo y haz clic en **'Configuración'**.\n" \
                        "2. 🔒 Ve a la pestaña interna que dice **'Eliminar cuenta'** (abajo en la sección de seguridad).\n" \
                        "3. ✍️ Lee detalladamente el mensaje de advertencia (esto borrará permanentemente tus préstamos, historial y registros) y escribe la frase de confirmación exacta solicitada para proceder."

    # CATEGORÍA 5: Roles, Permisos y Acciones Administrativas (consciente del rol)
    elif any(k in q for k in ['agregar usuario', 'crear usuario', 'nuevo usuario', 'añadir usuario', 'añadir aprendiz', 'agregar aprendiz', 'borrar usuario', 'eliminar usuario', 'modificar usuario', 'cambiar rol', 'subir de rol', 'ser admin', 'modificar inventario', 'agregar libro', 'agregar herramienta', 'borrar item', 'reportes', 'auditoria', 'auditoría']):
        if user_role == 'ADMIN':
            fallback_text = "Como **Administrador**, tienes acceso completo. Para gestionar usuarios ve al menú lateral → **Usuarios** y usa el botón **Nuevo usuario** arriba a la derecha. Para inventario → **Inventario**, para reportes → **Reportes**, para auditoría → **Auditoría**. Dime exactamente qué operación quieres realizar y te guío paso a paso."
        elif user_role in ('BIBLIOTECARIO', 'ALMACENISTA', 'SOPORTE'):
            fallback_text = f"Como **{user_role.capitalize()}**, no tienes permisos para gestionar usuarios ni realizar acciones de administrador del sistema. Esas tareas son exclusivas del Administrador. Sin embargo, tienes acceso completo a tus propias herramientas según tu rol — pregúntame qué quieres hacer dentro de tu área."
        else:
            fallback_text = "Esa acción está reservada para el **Administrador** del sistema. Como aprendiz/usuario solo puedes consultar el catálogo, hacer reservas y ver tus préstamos. Si necesitas que se modifique algo (por ejemplo, recuperar tu cuenta), escala al equipo de Soporte."

    # CATEGORÍA 6: Horarios de Atención
    elif any(k in q for k in ['horario', 'hora', 'abierto', 'cierran', 'abren', 'atencion', 'atención', 'sabado', 'domingo', 'festivo', 'calendario', 'dias', 'días']):
        fallback_text = f"🕒 **Horarios de Atención Oficiales — Sede Vélez:**\n\n" \
                        "*   **Lunes a Viernes:** 6:00 AM – 10:00 PM (Jornada continua).\n" \
                        "*   *(Nota pedagógica: Los miércoles abrimos a partir de las 6:30 AM debido a reuniones de instructores)*.\n" \
                        "*   **Sábados, Domingos y Festivos:** Cerrado al público.\n\n" \
                        "Te aconsejamos realizar cualquier trámite de entrega o devolución al menos 15 minutos antes de la hora de cierre para evitar congestiones en el sistema."

    # CATEGORÍA 7: Ubicaciones de los Bloques
    elif any(k in q for k in ['ubicacion', 'ubicación', 'donde', 'dónde', 'queda', 'sede', 'velez', 'vélez', 'bloque', 'ventanilla', 'pasillo', 'taller']):
        fallback_text = f"📍 **Ubicación de Puntos Físicos en la Sede Vélez:**\n\n" \
                        "Para reclamar tus reservas o devolver materiales, dirígete a:\n" \
                        "*   **Biblioteca (Libros y material académico):** Bloque Principal, primer piso, contiguo al pasillo administrativo central.\n" \
                        "*   **Almacén de Equipos (Herramientas, kits de desarrollo, soldadores):** Al fondo del pasillo técnico de talleres, justo al lado de las aulas de electricidad y mantenimiento industrial."

    # CATEGORÍA 8: Configuración, Perfil y Preferencias
    elif any(k in q for k in ['contraseña', 'contrasena', 'password', 'cambiar clave', 'clave', 'perfil', 'avatar', 'foto', 'correo', 'email', 'notificaciones', '2fa', 'seguridad', 'editar']):
        fallback_text = f"⚙️ **Manual de Configuración y Gestión de Perfil:**\n\n" \
                        "Puedes personalizar tu perfil ingresando al menú lateral izquierdo en **'Configuración'**. Allí verás un panel avanzado con pestañas dedicadas para:\n" \
                        "1. 👤 **Información personal:** Para actualizar tu foto de perfil (avatar), biografía y número de documento.\n" \
                        "2. 📧 **Correo electrónico:** Cambiar y verificar tu dirección de correo electrónico principal.\n" \
                        "3. 🔑 **Cambiar contraseña:** Modificar tu contraseña de ingreso ingresando la clave actual y confirmando la nueva.\n" \
                        "4. 🛡️ **Autenticación de dos factores (2FA):** Configurar seguridad por SMS o Google Authenticator.\n" \
                        "5. 💻 **Sesiones activas:** Ver qué dispositivos están conectados y cerrarlos remotamente si lo deseas."

    # CATEGORÍA 9: Pérdidas, Daños, Sanciones y Demoras
    elif any(k in q for k in ['perdí', 'perdi', 'pérdida', 'perdida', 'daño', 'dañó', 'rompí', 'rompi', 'malogrado', 'dañado', 'multa', 'sancion', 'sanción', 'castigo', 'atrasado', 'retraso', 'demora', 'suspension', 'suspensión']):
        fallback_text = f"⚠️ **Políticas de Sanciones, Demoras y Pérdidas del SENA:**\n\n" \
                        "El reglamento de biblioteca y almacén vela por el cuidado de los bienes del centro de formación:\n" \
                        "*   ⌛ **Retrasos:** Si no entregas a tiempo, tu cuenta será suspendida para préstamos nuevos por **1 día por cada día de retraso** por cada elemento pendiente.\n" \
                        "*   📦 **Daño o Pérdida:** Deberás reportarlo de inmediato al Bibliotecario o Almacenista. Cuentas con un plazo máximo de **15 días hábiles** para reponer el elemento por uno idéntico (marca y modelo) o de características superiores. Mientras no lo repongas, tu cuenta estará bloqueada.\n" \
                        "*   👨‍🏫 **Comité Pedagógico:** Demoras superiores a 10 días o la negación de reponer un bien público serán reportadas formalmente a coordinación académica para comité disciplinario."

    # CATEGORÍA 10: Requisitos para préstamos
    elif any(k in q for k in ['requisitos', 'reglamento', 'normas', 'politicas', 'políticas', 'quienes pueden', 'puedo pedir', 'carnet', 'documento', 'ficha', 'aprendiz', 'instructor']):
        fallback_text = f"🎓 **Requisitos Obligatorios para Solicitar Préstamos:**\n\n" \
                        "Para que el bibliotecario o almacenista apruebe tu entrega física en ventanilla, debes cumplir con:\n" \
                        "1. ✅ Tener una cuenta activa en la plataforma web (no estar en estado 'Invitado').\n" \
                        "2. 🪪 Presentar tu **carnet institucional del SENA** o documento de identidad original física.\n" \
                        "3. ⚖️ Estar al día con el sistema (no poseer retrasos, multas o suspensiones vigentes).\n" \
                        "4. ✍️ **Para herramientas pesadas:** Presentar la firma o autorización física o digital de tu instructor de taller."

    # CATEGORÍA 11: Exploración del Catálogo e Inventario (RAG en tiempo real)
    elif any(k in q for k in ['catalogo', 'catálogo', 'inventario', 'buscar', 'encontrar', 'tienen', 'hay', 'disponi', 'libro', 'herramienta', 'equipo', 'arduino', 'kit', 'computador', 'maquina', 'herramientas', 'elementos']):
        matches = [i for i in Item.query.all() if any(k in i.name.lower() for k in keywords)]
        if matches:
            fallback_text = f"🔍 **Resultados del Catálogo en Tiempo Real (Offline):**\n\n" \
                            f"Encontré los siguientes elementos relacionados en nuestro inventario local:\n\n"
            for item in matches[:5]:
                cat = item.category.name if item.category else 'General'
                status = item.status_obj.name if item.status_obj else 'AVAILABLE'
                fallback_text += f"*   📦 **{item.name}** ({cat}) | Código/ISBN: `{item.code}` | Stock: **{item.stock} uds** | Estado: `{status}`\n"
            fallback_text += "\n¡Puedes reservar estos elementos ingresando directamente a la sección **'Explorar elementos'**!"
        else:
            fallback_text = "Estuve revisando el catálogo físico de inventario y no encontré un elemento con ese nombre exacto. 🧐 ¿Podrías intentar buscarlo con otro término, o explorar el catálogo principal?"

    # CATEGORÍA 12: Creadores del sistema y Tecnología
    elif any(k in q for k in ['tecnologia', 'tecnología', 'desarrolladores', 'creadores', 'hecho con', 'programado', 'lenguaje', 'react', 'flask', 'python', 'javascript', 'sqlite', 'creó', 'creo']):
        fallback_text = f"💻 **Ficha Técnica y Creadores del Sistema:**\n\n" \
                        "Este portal web de Biblioteca y Almacén SENA ha sido desarrollado como una solución integral moderna utilizando las siguientes tecnologías:\n" \
                        "*   ⚛️ **Frontend:** React, TypeScript, React Icons y Vanilla CSS (Diseño premium interactivo).\n" \
                        "*   🐍 **Backend:** Python con Flask, Flask-JWT-Extended para seguridad y autenticación segura.\n" \
                        "*   🗄️ **Almacenamiento:** SQLite con ORM SQLAlchemy (Trazabilidad en tiempo real).\n" \
                        "*   🤖 **Inteligencia Artificial:** Google Gemini API (Modelo Flash) con un motor avanzado de RAG."

    # CATEGORÍA 13: Humor, Relaciones y Preguntas Personales (Easter Egg)
    elif any(k in q for k in ['novia', 'novio', 'pareja', 'amor', 'te amo', 'te quiero', 'casar', 'sentimientos', 'humano', 'amigo', 'amiga']):
        fallback_text = f"🤖 **¿Relaciones amorosas? ¡Mi único verdadero amor es poder ayudarte!**\n\n" \
                        "Como soy una Inteligencia Artificial programada en Python, Flask y React, no tengo sentimientos físicos, corazón ni capacidad para tener una pareja convencional. 💙\n\n" \
                        "Mi verdadera pasión es serte de utilidad, facilitarte el acceso al conocimiento y asegurarme de que consigas todos tus materiales a tiempo para tus clases de taller. ¡Así que mejor cuéntame en qué puedo ayudarte hoy!"

    # CATEGORÍA 14: Respeto, Límites de Vocabulario y Moderación
    elif any(k in q for k in ['perra', 'puta', 'mierda', 'maricon', 'maricón', 'bobo', 'pendejo', 'estupido', 'estúpido', 'malo', 'inservible', 'basura', 'hpta', 'gonorrea', 'boba', 'pendeja', 'estupida', 'estúpida', 'grosería', 'groseria', 'malparido', 'hijueputa']):
        fallback_text = f"⚠️ **Llamado al Respeto y Convivencia Académica SENA:**\n\n" \
                        "Como asistente inteligente educativo, estoy diseñado exclusivamente para apoyar el aprendizaje y organizar los activos del Centro de Formación.\n\n" \
                        "El reglamento del aprendiz promueve una cultura de respeto, tolerancia y uso de lenguaje profesional en todos los canales institucionales. " \
                        "Te invito cordialmente a reformular tu pregunta de manera respetuosa para poder asistirte con el inventario, libros, préstamos o reservas."

    # CATEGORÍA 15: Guía de Navegación y Uso Exacto de la Interfaz Web
    elif any(k in q for k in ['navegar', 'plataforma', 'interfaz', 'menu', 'menú', 'historial', 'mis reservas', 'notificaciones', 'como funciona', 'cómo funciona', 'donde encuentro', 'dónde encuentro', 'barra', 'navegacion', 'navegación']):
        fallback_text = f"🧭 **Guía Exacta de Navegación de la Plataforma SENA:**\n\n" \
                        "Nuestra interfaz web está estructurada en un **Panel Lateral Izquierdo** (Menú Principal) y una **Barra Superior**. Aquí tienes la ubicación exacta de cada módulo:\n\n" \
                        "1. 🏠 **Inicio (Dashboard):** Panel de control con el resumen de tus actividades, estadísticas en tiempo real y accesos rápidos.\n" \
                        "2. 📦 **Explorar elementos:** El catálogo interactivo. Usa la barra superior para filtrar por libros, equipos o arduino. Al hacer clic en un ítem, verás su foto, código, disponibilidad exacta y el botón de **Reservar**.\n" \
                        "3. 📅 **Mis préstamos:** Una tabla dinámica con el listado de lo que tienes físicamente en tu poder y los días/horas restantes para entregarlo.\n" \
                        "4. ⏳ **Mis reservas:** Muestra los elementos que separaste virtualmente y están esperando en la ventanilla (recuerda que expiran en 15 minutos exactos).\n" \
                        "5. 📜 **Historial:** Un registro tabular inmutable de absolutamente todos los préstamos pasados y devoluciones que has tramitado.\n" \
                        "6. 🔔 **Notificaciones (Campana arriba a la derecha):** Te avisa si se vence un plazo o si recibiste una sanción automática.\n" \
                        "7. ⚙️ **Configuración (Panel de Seguridad):** Ubicado en el menú lateral, incluye sub-pestañas para cambiar tu foto, correo, activar autenticación 2FA, ver sesiones activas y modificar contraseñas."

    # CATEGORÍA 16: Frustración del Usuario, Reclamaciones o Feedback Negativo
    elif any(k in q for k in ['gracias por nada', 'no sirves', 'no ayudas', 'peor asistente', 'inutil', 'inútil', 'pésimo', 'pesimo', 'lento', 'no funciona', 'ayuda en nada']):
        fallback_text = f"😔 **Lamento mucho escuchar eso, {user_name}.**\n\n" \
                        "Mi objetivo principal es serte de gran utilidad y facilitarte todos tus trámites en la biblioteca y el almacén de herramientas.\n\n" \
                        "Dado que actualmente mi conexión con los servidores de inteligencia de Google está inactiva y opero en **modo local de respaldo (offline)**, entiendo que mis respuestas puedan sentirse limitadas frente a tus expectativas.\n\n" \
                        "Tomaré muy en cuenta tu descontento para que los desarrolladores continúen ampliando mi sistema local de respaldo. " \
                        "Si hay algún problema específico que estés intentando resolver (como renovar tus materiales, ubicar un bloque o cambiar tu contraseña), por favor dímelo de otra forma e intentaré guiarte de la mejor manera posible."
        suggest_support = can_escalate

    # CATEGORÍA 17: Capacidad de Lectura de Audios e Imágenes (Multimedia Offline)
    elif any(k in q for k in ['audio', 'audios', 'grabar', 'escuchar', 'imagen', 'imágenes', 'imagenes', 'foto', 'fotos', 'tomar foto', 'cargar', 'subir foto', 'leer audio', 'ver foto', 'reproducir']):
        fallback_text = f"🎙️ **Análisis de Audios, Fotos e Imágenes (Soporte Multimedia):**\n\n" \
                        "Como tu asistente, **puedo procesar y analizar audios e imágenes únicamente cuando me encuentro en Modo Online** conectado con la API de Google Gemini.\n\n" \
                        "Aquí te explico la diferencia técnica de lo que ocurre en cada estado:\n\n" \
                        "*   🟢 **Modo Online (Conectado):** Tengo la capacidad completa de **escuchar y transcribir tus audios de voz**, así como de **analizar las imágenes o fotos** que subas (por ejemplo, para identificar una herramienta del almacén o leer el código de un libro) usando visión artificial en la nube.\n" \
                        "*   🔴 **Modo Offline (Local de Respaldo):** El procesamiento de imágenes y la transcripción de voz a texto requieren un poder de computación de redes neuronales masivo. Por ende, cuando opero de forma local, **estas funciones multimedia se desactivan temporalmente** y solo puedo responder a consultas que me escribas directamente por teclado.\n\n" \
                        "¡Si estás en modo offline, escríbeme tu pregunta por texto para poder ayudarte al instante!"

    # CASO POR DEFECTO: pregunta fuera del catálogo de reglas conocidas.
    # No exponemos al usuario detalles internos de "modo offline" — solo le ofrecemos
    # escalar al equipo de Soporte si su rol lo permite.
    else:
        fallback_text = "No tengo una respuesta precisa para esa consulta. ¿Quieres reformularla o prefieres que te contacte con el equipo de Soporte?"
        suggest_support = can_escalate
        # Quedó un hueco de contenido: ni las reglas ni la IA que aprende supieron
        # responder. Se registra para que un Admin lo revise y, si quiere, enseñe
        # la respuesta a mano desde el panel de conocimiento del asistente.
        try:
            db.session.add(AIUnansweredQuery(
                query_text=user_query[:500],
                role=user_role,
                user_id=str(user.id) if user else None,
            ))
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f"[IA-PROPIA] Error registrando pregunta sin respuesta: {e}")

    return jsonify({
        "text": fallback_text,
        "type": "text",
        "metadata": active_loans_list if active_loans_list else None,
        "suggest_support": suggest_support,
        "source": "rules",
    })


# ─── Saludo inicial automático ───────────────────────────────────────────────

@assistant_bp.route('/greeting', methods=['GET'])
@jwt_required(optional=True)
def get_greeting():
    """Endpoint de compatibilidad: el saludo inicial ahora se genera en el
    frontend (pantalla vacía con título aleatorio), no se necesita llamar a
    esto para mostrar la conversación nueva. Se deja un saludo determinista
    mínimo por si algo externo todavía lo consulta."""
    user_id = get_jwt_identity()
    user = User.query.filter_by(id=str(user_id)).first() if user_id else None
    user_name = assistant_display_name(user, first_name_only=True)

    return jsonify({
        "text": f"¡Hola **{user_name}**! 👋 Soy SENA Bot, tu asistente virtual. ¿En qué puedo ayudarte hoy?",
        "source": "default-greeting",
    })


# ─── Confirmación de acciones automatizadas del asistente ────────────────────

@assistant_bp.route('/confirm-action', methods=['POST'])
@jwt_required()
def confirm_action():
    """Ejecuta (o descarta) una acción que el asistente propuso — reservar,
    cancelar una reserva, o cerrar una sesión. El token viene firmado por
    _action_serializer() con el user_id incluido, así que aunque alguien
    manipulara el token desde el navegador, solo se ejecuta si coincide con
    el usuario del JWT actual (nunca se confía en un user_id que mande el
    cliente sin firmar)."""
    data = request.get_json() or {}
    token = data.get('token')
    confirm = bool(data.get('confirm'))
    if not token:
        return jsonify({"error": "Falta el token de la acción."}), 400

    try:
        payload = _action_serializer().loads(token, max_age=ACTION_MAX_AGE)
    except SignatureExpired:
        return jsonify({"text": "Esa confirmación ya expiró. Pídemelo de nuevo."}), 200
    except BadSignature:
        return jsonify({"error": "Confirmación inválida."}), 400

    current_user_id = str(get_jwt_identity())
    if str(payload.get('user_id')) != current_user_id:
        return jsonify({"error": "Esta confirmación no te pertenece."}), 403

    if not confirm:
        return jsonify({"text": "Listo, no hice ningún cambio."}), 200

    action = payload.get('action')
    params = payload.get('params') or {}

    try:
        if action == 'crear_reserva':
            res, err = enqueue_reservation(user_id=current_user_id, item_id=params.get('item_id'))
            if err:
                return jsonify({"text": f"No pude completar la reserva: {err}"}), 200
            estado = "lista para reclamar en los próximos 15 minutos" if res.status == 'READY' else "en cola de espera"
            return jsonify({"text": f"✅ Reserva creada para \"{params.get('item_name', 'el elemento')}\": queda {estado}."}), 200

        if action == 'cancelar_reserva':
            rid = params.get('reservation_id')
            res = Reservation.query.filter_by(id=rid, user_id=current_user_id).first()
            if not res:
                return jsonify({"text": "Esa reserva ya no existe."}), 200
            if res.status not in ('QUEUED', 'READY'):
                return jsonify({"text": "Esa reserva ya no se puede cancelar (cambió de estado)."}), 200
            was_ready = res.status == 'READY'
            res.status = 'CANCELLED'
            db.session.commit()
            if was_ready:
                on_item_available(res.item_id)
                db.session.commit()
            return jsonify({"text": f"✅ Cancelé tu reserva de \"{params.get('item_name', 'el elemento')}\"."}), 200

        if action == 'cerrar_sesion':
            mode = params.get('mode')
            if mode == 'all':
                RefreshToken.query.filter_by(user_id=current_user_id, is_revoked=False).update({"is_revoked": True})
                TrustedDevice.query.filter_by(user_id=current_user_id).delete()
                db.session.commit()
                return jsonify({"text": "✅ Cerré todas tus sesiones y olvidé todos los dispositivos.", "session_ended": True}), 200

            sid = params.get('session_id')
            tok = RefreshToken.query.filter_by(id=sid, user_id=current_user_id).first()
            if not tok:
                return jsonify({"text": "Esa sesión ya no existe."}), 200
            tok.is_revoked = True
            if tok.device_id:
                TrustedDevice.query.filter_by(user_id=current_user_id, device_id=tok.device_id).delete()
            db.session.commit()
            ended_current = (mode == 'current')
            msg = "✅ Listo, cerré esta sesión." if ended_current else "✅ Cerré la sesión de ese dispositivo."
            return jsonify({"text": msg, "session_ended": ended_current}), 200

        return jsonify({"error": "Acción desconocida."}), 400
    except Exception as e:
        db.session.rollback()
        print(f"[assistant confirm-action] error ejecutando '{action}': {e}")
        return jsonify({"error": "Ocurrió un error ejecutando la acción."}), 500


def _require_admin():
    """Devuelve (user, None) si quien llama es Admin, o (None, response) si no."""
    uid = get_jwt_identity()
    u = User.query.get(uid) if uid else None
    if not u or not u.role or (u.role.name or '').upper() != 'ADMIN':
        return None, (jsonify({"error": "Solo un administrador puede acceder a esto."}), 403)
    return u, None


# ─── Retroalimentación sobre respuestas de la IA que aprende ─────────────────

@assistant_bp.route('/feedback', methods=['POST'])
@jwt_required()
def learned_feedback():
    """👍/👎 sobre una respuesta del asistente. Si trae `learned_id`, es sobre
    una entrada ya cacheada por la IA que aprende (afecta sus contadores y
    puede autoeliminarla si acumula demasiados negativos). Si no, es sobre
    una respuesta cualquiera (Gemini en vivo, modo offline, etc.) — se
    registra en AIResponseFeedback solo como histórico para revisión."""
    data = request.get_json() or {}
    learned_id = data.get('learned_id')
    useful = bool(data.get('useful'))

    if not learned_id:
        user_id = str(get_jwt_identity())
        user = User.query.filter_by(id=user_id).first()
        role_name = (user.role.name if user and user.role else None)
        db.session.add(AIResponseFeedback(
            user_id=user_id,
            role=role_name,
            query_text=(data.get('query_text') or '')[:500] or None,
            response_text=data.get('response_text'),
            useful=useful,
            source=data.get('source'),
        ))
        db.session.commit()
        return jsonify({"ok": True}), 200

    learned = AILearnedResponse.query.get(learned_id)
    if not learned:
        return jsonify({"error": "Esa respuesta ya no existe."}), 404

    if useful:
        learned.positive_feedback = (learned.positive_feedback or 0) + 1
        db.session.commit()
        return jsonify({"ok": True}), 200

    learned.negative_feedback = (learned.negative_feedback or 0) + 1
    if learned.negative_feedback - (learned.positive_feedback or 0) >= NEGATIVE_FEEDBACK_AUTODELETE_MARGIN:
        db.session.delete(learned)
        db.session.commit()
        print(f"[IA-PROPIA] Entrada #{learned_id} autoeliminada por retroalimentación negativa.")
        return jsonify({"ok": True, "deleted": True}), 200

    db.session.commit()
    return jsonify({"ok": True}), 200


# ─── Panel de conocimiento del asistente (solo Admin) ────────────────────────

@assistant_bp.route('/learned', methods=['GET'])
@jwt_required()
def list_learned_responses():
    """Lista paginada de todo lo que la IA ha aprendido, con búsqueda opcional."""
    admin, err = _require_admin()
    if err:
        return err

    search = (request.args.get('search') or '').strip()
    page = max(1, int(request.args.get('page', 1)))
    per_page = min(100, max(1, int(request.args.get('per_page', 25))))

    query = AILearnedResponse.query
    if search:
        like = f"%{search}%"
        query = query.filter(db.or_(
            AILearnedResponse.query_text.ilike(like),
            AILearnedResponse.response_text.ilike(like),
            AILearnedResponse.query_keywords.ilike(like),
        ))

    total = query.count()
    items = (query.order_by(AILearnedResponse.updated_at.desc().nullslast())
             .offset((page - 1) * per_page).limit(per_page).all())

    cutoff = datetime.utcnow() - timedelta(days=LEARNED_RESPONSE_TTL_DAYS)
    return jsonify({
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [{
            "id": i.id,
            "query_text": i.query_text,
            "query_keywords": i.query_keywords,
            "response_text": i.response_text,
            "role": i.role,
            "source": i.source,
            "use_count": i.use_count or 0,
            "positive_feedback": i.positive_feedback or 0,
            "negative_feedback": i.negative_feedback or 0,
            "created_at": i.created_at.isoformat() if i.created_at else None,
            "updated_at": i.updated_at.isoformat() if i.updated_at else None,
            "expired": bool(i.updated_at and i.updated_at < cutoff),
        } for i in items],
    }), 200


@assistant_bp.route('/learned', methods=['POST'])
@jwt_required()
def create_learned_response():
    """Enseñar una respuesta a mano (sin esperar a que Gemini la conteste primero)."""
    admin, err = _require_admin()
    if err:
        return err

    data = request.get_json() or {}
    query_text = (data.get('query_text') or '').strip()
    response_text = (data.get('response_text') or '').strip()
    role = (data.get('role') or '').strip().upper() or None
    if not query_text or not response_text:
        return jsonify({"error": "query_text y response_text son obligatorios."}), 400

    kws = get_query_keywords(query_text)
    if len(kws) <= 5:
        return jsonify({"error": "La pregunta es demasiado corta/genérica para indexarla de forma confiable."}), 400

    entry = AILearnedResponse(
        query_text=query_text,
        query_keywords=kws,
        response_text=response_text,
        role=role,
        source='manual',
    )
    db.session.add(entry)
    db.session.commit()
    return jsonify({"id": entry.id}), 201


@assistant_bp.route('/learned/<int:entry_id>', methods=['PUT'])
@jwt_required()
def update_learned_response(entry_id):
    admin, err = _require_admin()
    if err:
        return err

    entry = AILearnedResponse.query.get(entry_id)
    if not entry:
        return jsonify({"error": "No encontrada."}), 404

    data = request.get_json() or {}
    if 'response_text' in data:
        entry.response_text = (data.get('response_text') or '').strip()
    if 'query_text' in data and data.get('query_text', '').strip():
        entry.query_text = data['query_text'].strip()
        entry.query_keywords = get_query_keywords(entry.query_text)
    if 'role' in data:
        entry.role = (data.get('role') or '').strip().upper() or None
    entry.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True}), 200


@assistant_bp.route('/learned/<int:entry_id>', methods=['DELETE'])
@jwt_required()
def delete_learned_response(entry_id):
    admin, err = _require_admin()
    if err:
        return err

    entry = AILearnedResponse.query.get(entry_id)
    if not entry:
        return jsonify({"error": "No encontrada."}), 404
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"ok": True}), 200


@assistant_bp.route('/unanswered', methods=['GET'])
@jwt_required()
def list_unanswered_queries():
    """Preguntas que ni las reglas ni la IA que aprende supieron responder —
    huecos de contenido para que un Admin revise y, si quiere, enseñe."""
    admin, err = _require_admin()
    if err:
        return err

    only_pending = (request.args.get('pending', 'true').lower() == 'true')
    query = AIUnansweredQuery.query
    if only_pending:
        query = query.filter_by(resolved=False)
    items = query.order_by(AIUnansweredQuery.created_at.desc()).limit(200).all()

    return jsonify([{
        "id": i.id,
        "query_text": i.query_text,
        "role": i.role,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "resolved": i.resolved,
    } for i in items]), 200


@assistant_bp.route('/unanswered/<int:entry_id>', methods=['PUT'])
@jwt_required()
def resolve_unanswered_query(entry_id):
    admin, err = _require_admin()
    if err:
        return err
    entry = AIUnansweredQuery.query.get(entry_id)
    if not entry:
        return jsonify({"error": "No encontrada."}), 404
    entry.resolved = True
    db.session.commit()
    return jsonify({"ok": True}), 200


@assistant_bp.route('/unanswered/<int:entry_id>', methods=['DELETE'])
@jwt_required()
def delete_unanswered_query(entry_id):
    admin, err = _require_admin()
    if err:
        return err
    entry = AIUnansweredQuery.query.get(entry_id)
    if not entry:
        return jsonify({"error": "No encontrada."}), 404
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"ok": True}), 200


# ─── Threads del Asistente Personal (persistencia por usuario) ───────────────

def _no_history_role(user_id):
    """El rol genérico 'USUARIO' (cuentas públicas sin identidad verificada,
    fuera de aprendices/personal) no guarda historial de conversaciones: cada
    sesión del asistente arranca limpia, por privacidad y simplicidad."""
    user = User.query.filter_by(id=str(user_id)).first()
    role_name = (user.role.name if user and user.role else '') or ''
    return role_name.upper() == 'USUARIO'


@assistant_bp.route('/threads', methods=['GET'])
@jwt_required()
def get_threads():
    user_id = str(get_jwt_identity())
    if _no_history_role(user_id):
        return jsonify([])
    threads = AssistantThread.query.filter_by(user_id=user_id).order_by(AssistantThread.updated_at.desc()).all()
    return jsonify([{
        'id': t.id,
        'title': t.title,
        'messages': json.loads(t.messages or '[]'),
        'updatedAt': t.updated_at.isoformat() if t.updated_at else t.created_at.isoformat(),
    } for t in threads])


@assistant_bp.route('/threads', methods=['POST'])
@jwt_required()
def create_thread():
    user_id = str(get_jwt_identity())
    data = request.get_json() or {}
    if _no_history_role(user_id):
        # No se persiste nada, pero se responde éxito para que el frontend
        # (que trata esta cuenta igual que un invitado) no falle.
        return jsonify({'id': data.get('id', f"thread_{int(time.time() * 1000)}")}), 201
    thread = AssistantThread(
        id=data.get('id', f"thread_{int(time.time() * 1000)}"),
        user_id=user_id,
        title=data.get('title', 'Nueva conversación'),
        messages=json.dumps(data.get('messages', [])),
    )
    db.session.add(thread)
    db.session.commit()
    return jsonify({'id': thread.id}), 201


@assistant_bp.route('/threads/<thread_id>', methods=['PUT'])
@jwt_required()
def update_thread(thread_id):
    user_id = str(get_jwt_identity())
    if _no_history_role(user_id):
        return jsonify({'ok': True})
    thread = AssistantThread.query.filter_by(id=thread_id, user_id=user_id).first()
    if not thread:
        return jsonify({'error': 'No encontrado'}), 404
    data = request.get_json() or {}
    if 'title' in data:
        thread.title = data['title']
    if 'messages' in data:
        thread.messages = json.dumps(data['messages'])
    from datetime import datetime
    thread.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'ok': True})


@assistant_bp.route('/threads/<thread_id>', methods=['DELETE'])
@jwt_required()
def delete_thread(thread_id):
    user_id = str(get_jwt_identity())
    if _no_history_role(user_id):
        return jsonify({'ok': True})
    thread = AssistantThread.query.filter_by(id=thread_id, user_id=user_id).first()
    if not thread:
        return jsonify({'error': 'No encontrado'}), 404
    db.session.delete(thread)
    db.session.commit()
    return jsonify({'ok': True})

