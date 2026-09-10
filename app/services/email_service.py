"""Servicio de envío de correos para Biblioteca & Almacén SENA.

Todos los correos comparten la misma identidad visual: cabecera SENA sobre
azul institucional, saludo con el nombre de la persona, tarjeta blanca de
contenido, bloque de "Mensaje personalizado" opcional, botón de acción y pie
institucional ("Formación que transforma vidas" · Biblioteca · Almacén · SENA).

El compositor central es `render_email()`. Cada método de `EmailService` solo
arma su "tarjeta de contenido" y delega el resto en esa plantilla.

Métodos públicos de EmailService:
  - send_verification_code      → código para confirmar el registro de cuenta
  - send_password_change_code   → código para confirmar el cambio de contraseña
  - send_temporary_password     → contraseña temporal (recuperación de acceso)
  - send_notification           → notificación genérica (préstamos, reservas, multas…)
  - send_recovery_email         → (legacy) enlace de recuperación con token
"""
import re
from datetime import datetime

from flask import current_app
from flask_mail import Message

from ..extensions import mail


# ── Paleta de marca ──────────────────────────────────────────────────
NAVY       = "#0f2b46"
NAVY_DARK  = "#0a2038"
NAVY_SOFT  = "#14406b"
GREEN      = "#39A900"
GREEN_DARK = "#2b7a00"
LIME       = "#8dc63f"
HERO_BG    = "#f4f8fc"
PANEL_BG   = "#f6f9fc"
TEXT       = "#374151"
MUTED      = "#6b7280"
DIVIDER    = "#2b4763"

_TAG_RE = re.compile(r"<[^>]+>")


# ── Utilidades ───────────────────────────────────────────────────────

def _base_url() -> str:
    """URL pública del sitio (sin barra final). Se usa para enlaces e imágenes."""
    raw = current_app.config.get("PUBLIC_BASE_URL") or "https://sena.newonline.digital"
    return raw.rstrip("/")


def _asset(name: str) -> str:
    """URL absoluta de una imagen estática servida por el backend (dist/assets/images)."""
    return f"{_base_url()}/assets/images/{name}"


def _esc(value) -> str:
    """Escapa texto que va incrustado en el HTML del correo (nombres, mensajes libres)."""
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _strip_tags(value) -> str:
    """Versión en texto plano de un valor que puede traer HTML (para el cuerpo alterno)."""
    return _TAG_RE.sub("", str(value)).strip()


# ── Bloques reutilizables ────────────────────────────────────────────

def status_pill(text: str, bg: str = GREEN) -> str:
    """HTML de una etiqueta redondeada de estado (p. ej. 'Prestado')."""
    return (
        f'<span style="display:inline-block;padding:5px 15px;border-radius:999px;'
        f'background:{bg};color:#ffffff;font-size:13px;font-weight:700;line-height:1.4;">{text}</span>'
    )


def _rows_table(rows) -> str:
    """rows: lista de (etiqueta, valor_html). El valor puede ser texto o HTML (pill)."""
    cells = "".join(
        f'<tr><td style="padding:7px 0;">'
        f'<div style="font-size:12px;color:{MUTED};margin-bottom:2px;">{label}</div>'
        f'<div style="font-size:15px;font-weight:700;color:{NAVY};">{value}</div>'
        f'</td></tr>'
        for label, value in rows
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">'
        f'{cells}</table>'
    )


def _panel(inner_html: str, image_url: str = None) -> str:
    """Panel interior gris claro; opcionalmente con la foto del elemento a la izquierda."""
    img_cell = ""
    if image_url:
        img_cell = (
            f'<td width="122" valign="middle" style="padding:14px 4px 14px 16px;">'
            f'<img src="{image_url}" width="106" alt="" '
            f'style="width:106px;border-radius:10px;background:#e6f4ea;display:block;"></td>'
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:{PANEL_BG};border-radius:12px;margin-top:14px;">'
        f'<tr>{img_cell}<td style="padding:14px 18px;">{inner_html}</td></tr></table>'
    )


def _card(inner_html: str, icon: str = "🔔", heading: str = "", subtext: str = "") -> str:
    """Tarjeta blanca con círculo verde + título (como la del diseño de referencia)."""
    header = ""
    if heading:
        sub = (
            f'<div style="font-size:13px;color:{MUTED};margin-top:3px;line-height:1.5;">{subtext}</div>'
            if subtext else ""
        )
        header = (
            '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
            '<td width="54" valign="top">'
            f'<div style="width:42px;height:42px;line-height:42px;text-align:center;'
            f'border-radius:50%;background:{GREEN};color:#ffffff;font-size:19px;">{icon}</div></td>'
            '<td style="padding-left:12px;">'
            f'<div style="font-size:16px;font-weight:800;color:{NAVY};line-height:1.3;">{heading}</div>'
            f'{sub}</td></tr></table>'
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#ffffff;border-radius:16px;box-shadow:0 4px 16px rgba(15,43,70,.10);">'
        f'<tr><td style="padding:20px 22px;">{header}{inner_html}</td></tr></table>'
    )


def _code_box(code: str, expires: str, label: str = "Código de verificación") -> str:
    """Caja destacada con el código de un solo uso y su caducidad."""
    return (
        f'<div style="border:1px dashed {GREEN};border-radius:12px;padding:18px;text-align:center;margin-top:6px;">'
        f'<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{MUTED};">{label}</div>'
        f'<div style="font-size:34px;font-weight:800;letter-spacing:10px;color:{GREEN};margin-top:8px;">{code}</div>'
        f'</div>'
        f'<p style="font-size:12px;color:{MUTED};margin:12px 0 0;line-height:1.5;">'
        f'Este código expira en <strong>{expires}</strong>. Si no reconoces esta solicitud, '
        f'ignora este mensaje.</p>'
    )


def _button(text: str, url: str) -> str:
    """Botón de acción redondeado (verde), con degradado en clientes que lo soporten."""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">'
        f'<tr><td align="center" bgcolor="{GREEN_DARK}" '
        f'style="border-radius:999px;background:{GREEN_DARK};background:linear-gradient(90deg,{GREEN_DARK},{GREEN});">'
        f'<a href="{url}" target="_blank" '
        'style="display:inline-block;padding:14px 36px;font-family:Arial,Helvetica,sans-serif;'
        'font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;">'
        f'🔗&nbsp; {text} &nbsp;→</a></td></tr></table>'
    )


def _personal_message_box(text_html: str) -> str:
    """Bloque verde de 'Mensaje personalizado' (texto libre de un funcionario)."""
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        f'style="background:#eef7ec;border-left:4px solid {GREEN};border-radius:10px;">'
        '<tr><td style="padding:14px 18px;">'
        f'<div style="font-size:13px;font-weight:800;color:{GREEN_DARK};margin-bottom:4px;">✉ Mensaje personalizado</div>'
        f'<div style="font-size:14px;color:{TEXT};line-height:1.55;">{text_html}</div>'
        '</td></tr></table>'
    )


# ── Plantilla maestra ────────────────────────────────────────────────

def render_email(subject, greeting_name="", intro="", content_html="",
                 personal_message=None, cta_text=None, cta_url=None,
                 closing=None, show_mascot=True, preheader=""):
    """Compone el HTML completo de un correo con la identidad de marca.

    - subject          : asunto (también <title> del documento).
    - greeting_name     : nombre para el saludo. Vacío → "¡Hola!".
    - intro             : párrafo introductorio (admite HTML de confianza, p. ej. <strong>).
    - content_html      : tarjeta(s) de contenido ya construidas (`_card`, `_panel`…).
    - personal_message  : texto libre → bloque verde "Mensaje personalizado" (se escapa).
    - cta_text/cta_url  : botón de acción (ambos requeridos para que aparezca).
    - closing           : línea final centrada. None → texto por defecto.
    - show_mascot       : muestra al personaje SENA junto al saludo.
    - preheader         : texto de vista previa en la bandeja (oculto en el cuerpo).
    """
    year = datetime.now().year
    logo = _asset("email-logo.png")
    mascot = _asset("email-mascot.png")

    if greeting_name:
        greeting = (
            f'Hola,<br><span style="color:{GREEN};">{_esc(greeting_name)}</span> '
            '<span style="font-size:22px;">👋</span>'
        )
    else:
        greeting = '¡Hola! <span style="font-size:22px;">👋</span>'

    mascot_cell = ""
    if show_mascot:
        mascot_cell = (
            f'<td width="160" valign="middle" align="right" style="padding-left:6px;background:{HERO_BG};">'
            f'<img src="{mascot}" width="150" alt="" style="width:150px;display:block;"></td>'
        )

    intro_html = (
        f'<p style="margin:16px 0 0;font-size:15px;color:{TEXT};line-height:1.6;">{intro}</p>'
        if intro else ""
    )

    blocks = [
        f'<tr><td style="background:{HERO_BG};padding:14px 28px 4px;">{content_html}</td></tr>'
    ]
    if personal_message:
        body = _esc(personal_message).replace("\n", "<br>")
        blocks.append(
            f'<tr><td style="background:{HERO_BG};padding:14px 28px 2px;">'
            f'{_personal_message_box(body)}</td></tr>'
        )
    if cta_text and cta_url:
        blocks.append(
            f'<tr><td style="background:{HERO_BG};padding:22px 28px 6px;">'
            f'{_button(cta_text, cta_url)}</td></tr>'
        )

    closing = closing or (
        "Si tienes alguna duda, puedes responder este correo o comunicarte "
        "con el equipo de Biblioteca &amp; Almacén SENA."
    )

    return (
        '<!DOCTYPE html>\n'
        '<html lang="es"><head>'
        '<meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta name="x-apple-disable-message-reformatting">'
        f'<title>{subject}</title></head>'
        '<body style="margin:0;padding:0;background:#eef2f6;">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{preheader}</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="background:#eef2f6;"><tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;'
        'font-family:Arial,Helvetica,sans-serif;box-shadow:0 8px 30px rgba(15,43,70,.12);">'

        # ── Cabecera ──
        f'<tr><td bgcolor="{NAVY}" style="background:{NAVY};'
        f'background:linear-gradient(120deg,{NAVY_DARK},{NAVY_SOFT});padding:22px 26px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        '<td valign="middle">'
        f'<img src="{logo}" width="42" alt="SENA" '
        'style="width:42px;vertical-align:middle;border-radius:50%;">'
        '<span style="display:inline-block;vertical-align:middle;margin-left:12px;color:#ffffff;'
        'font-size:18px;font-weight:800;line-height:1.2;">BIBLIOTECA &amp;<br>ALMACÉN SENA</span>'
        '</td>'
        '<td valign="middle" align="right">'
        '<div style="color:#ffffff;font-size:13px;font-weight:700;">Sistema de gestión</div>'
        '<div style="color:#b8c7d9;font-size:11px;">Tus recursos, nuestro compromiso</div>'
        '</td></tr></table></td></tr>'
        f'<tr><td style="height:5px;background:{GREEN};font-size:0;line-height:0;">&nbsp;</td></tr>'

        # ── Saludo + personaje ──
        f'<tr><td style="background:{HERO_BG};padding:26px 28px 6px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        '<td valign="top">'
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td width="4" style="background:{GREEN};font-size:0;line-height:0;">&nbsp;</td>'
        f'<td style="padding-left:14px;font-size:25px;font-weight:800;color:{NAVY};line-height:1.25;">{greeting}</td>'
        '</tr></table></td>'
        f'{mascot_cell}'
        '</tr></table>'
        f'{intro_html}'
        '</td></tr>'

        + "".join(blocks) +

        # ── Línea de cierre ──
        f'<tr><td style="background:{HERO_BG};padding:16px 34px 26px;text-align:center;'
        f'color:{MUTED};font-size:13px;line-height:1.55;">{closing}</td></tr>'

        # ── Pie institucional ──
        f'<tr><td style="height:5px;background:{GREEN};font-size:0;line-height:0;">&nbsp;</td></tr>'
        f'<tr><td bgcolor="{NAVY}" style="background:{NAVY};padding:24px 28px;">'
        "<div style=\"font-family:'Segoe Script','Bradley Hand','Brush Script MT',cursive;"
        f'font-style:italic;color:{LIME};font-size:18px;margin-bottom:16px;">Formación que transforma vidas</div>'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>'
        '<td align="center" style="color:#dbe6f0;font-size:12px;line-height:1.7;">📚<br>Biblioteca</td>'
        f'<td width="1" style="background:{DIVIDER};">&nbsp;</td>'
        '<td align="center" style="color:#dbe6f0;font-size:12px;line-height:1.7;">📦<br>Almacén</td>'
        f'<td width="1" style="background:{DIVIDER};">&nbsp;</td>'
        '<td align="center" style="color:#dbe6f0;font-size:12px;line-height:1.7;">👥<br>SENA</td>'
        f'<td align="right" width="56"><img src="{logo}" width="38" alt="" '
        'style="width:38px;border-radius:50%;"></td>'
        '</tr></table></td></tr>'
        f'<tr><td bgcolor="{NAVY_DARK}" style="background:{NAVY_DARK};padding:16px 28px;text-align:center;'
        'color:#8ea3ba;font-size:11px;line-height:1.6;">'
        f'Servicio Nacional de Aprendizaje · SENA &nbsp;|&nbsp; Biblioteca &amp; Almacén &nbsp;·&nbsp; © {year}'
        "<div style=\"font-family:'Segoe Script','Bradley Hand','Brush Script MT',cursive;"
        f'font-style:italic;color:{LIME};font-size:13px;margin-top:6px;">¡Seguimos conectados!</div>'
        '</td></tr>'

        '</table></td></tr></table></body></html>'
    )


def _send(subject: str, recipients: list, text_body: str, html_body: str = None) -> bool:
    """Envía un correo. Si MAIL_SERVER no está configurado, hace print (modo local)."""
    try:
        if not current_app.config.get('MAIL_SERVER'):
            print(f"DEBUG EMAIL [{subject}] → {recipients}\n{text_body}\n")
            return True

        msg = Message(subject, recipients=recipients,
                      sender=current_app.config.get('MAIL_DEFAULT_SENDER'))
        msg.body = text_body
        if html_body:
            msg.html = html_body
        mail.send(msg)
        return True
    except Exception as e:
        print(f"Error enviando correo '{subject}' a {recipients}: {e}")
        return False


# ─────────────────────────  API PÚBLICA  ─────────────────────────────

class EmailService:

    @staticmethod
    def status_pill(text: str, bg: str = GREEN) -> str:
        """Etiqueta de estado redondeada, para usar en `rows` de send_notification."""
        return status_pill(text, bg)

    # ── Registro de cuenta ──
    @staticmethod
    def send_verification_code(email: str, code: str, user_name: str = '', verify_link: str = None) -> bool:
        """Código de 6 dígitos para confirmar el registro de cuenta.

        `verify_link`: URL del botón "Ir a la plataforma". Si se pasa, lleva a la
        pantalla de ingresar el código con los datos del registro ya precargados
        (funciona en cualquier dispositivo). Si no, cae a la portada del sitio.
        """
        subject = "Verifica tu cuenta — Biblioteca SENA"
        content = _card(
            _code_box(code, "15 minutos"),
            icon="🔒",
            heading="Activa tu cuenta",
            subtext="Ingresa este código en la plataforma para completar tu registro.",
        )
        html = render_email(
            subject,
            greeting_name=user_name,
            intro=("Gracias por registrarte en <strong>Biblioteca &amp; Almacén SENA</strong>. "
                   "Solo falta un paso para activar tu cuenta."),
            content_html=content,
            cta_text="Ir a la plataforma",
            cta_url=verify_link or _base_url(),
            preheader="Código para activar tu cuenta en Biblioteca & Almacén SENA",
        )
        text = (
            f"Hola {user_name},\n\n"
            f"Tu código de verificación es: {code}\n\n"
            f"Este código expira en 15 minutos.\n"
            f"Si no creaste esta cuenta, ignora este mensaje."
        )
        return _send(subject, [email], text, html)

    # ── Cambio de contraseña (desde Configuración) ──
    @staticmethod
    def send_password_change_code(email: str, code: str, user_name: str = '') -> bool:
        """Código para confirmar el cambio de contraseña."""
        subject = "Confirma el cambio de tu contraseña — Biblioteca SENA"
        content = _card(
            _code_box(code, "10 minutos", label="Código de confirmación"),
            icon="🔑",
            heading="Cambio de contraseña",
            subtext=("Introduce este código para confirmar el cambio. Si no fuiste tú, "
                     "cambia tu contraseña de inmediato."),
        )
        html = render_email(
            subject,
            greeting_name=user_name,
            intro="Recibimos una solicitud para cambiar la contraseña de tu cuenta.",
            content_html=content,
            preheader="Código para confirmar el cambio de tu contraseña",
        )
        text = (
            f"Hola {user_name},\n\n"
            f"Tu código para confirmar el cambio de contraseña es: {code}\n\n"
            f"Expira en 10 minutos. Si no solicitaste este cambio, alguien podría tener acceso a tu cuenta."
        )
        return _send(subject, [email], text, html)

    # ── Verificación en dos pasos (login) ──
    @staticmethod
    def send_2fa_code(email: str, code: str, user_name: str = '') -> bool:
        """Código de un solo uso para completar el inicio de sesión (2FA por correo)."""
        subject = "Tu código para iniciar sesión — Biblioteca SENA"
        content = _card(
            _code_box(code, "10 minutos", label="Código de acceso"),
            icon="🔐",
            heading="Verificación en dos pasos",
            subtext="Introduce este código en la plataforma para terminar de iniciar sesión.",
        )
        html = render_email(
            subject,
            greeting_name=user_name,
            intro="Alguien está iniciando sesión en tu cuenta. Si eres tú, usa este código.",
            content_html=content,
            preheader="Código de un solo uso para iniciar sesión",
        )
        text = (
            f"Hola {user_name},\n\n"
            f"Tu código para iniciar sesión es: {code}\n\n"
            f"Expira en 10 minutos. Si no fuiste tú, cambia tu contraseña."
        )
        return _send(subject, [email], text, html)

    # ── Aviso de dispositivo nuevo (autorización de login) ──
    @staticmethod
    def send_new_device_alert(email: str, user_name: str, approve_link: str, *,
                              device_label: str = '', location: str = None,
                              ip: str = '', when: str = '') -> bool:
        """Aviso de intento de acceso desde un dispositivo no reconocido, con botón
        de autorización que vence en 15 minutos."""
        subject = "¿Estás intentando iniciar sesión? — Biblioteca SENA"
        rows = []
        if device_label:
            rows.append(("Dispositivo", device_label))
        rows.append(("Ubicación aproximada", location or "No disponible"))
        if ip:
            rows.append(("Dirección IP", ip))
        if when:
            rows.append(("Fecha y hora", when))

        inner = (
            _panel(_rows_table(rows))
            + f'<p style="margin:14px 0 0;font-size:13px;color:{MUTED};line-height:1.55;">'
            f'Si eres tú, pulsa el botón para autorizar este dispositivo e iniciar sesión. '
            f'El enlace vence en <strong>15 minutos</strong>. Si no fuiste tú, ignora este '
            f'correo y cambia tu contraseña cuanto antes.</p>'
        )
        content = _card(
            inner,
            icon="🛡️",
            heading="Alguien está intentando acceder desde un dispositivo nuevo",
            subtext="Por seguridad necesitamos que confirmes que eres tú.",
        )
        html = render_email(
            subject,
            greeting_name=user_name,
            intro=("Detectamos un intento de inicio de sesión en tu cuenta desde un "
                   "dispositivo que no reconocemos."),
            content_html=content,
            cta_text="Iniciar sesión",
            cta_url=approve_link,
            preheader="Autoriza el dispositivo para iniciar sesión (el enlace vence en 15 min)",
        )
        text = (
            f"Hola {user_name},\n\n"
            f"Alguien está intentando iniciar sesión en tu cuenta desde un dispositivo nuevo.\n"
            + (f"Dispositivo: {device_label}\n" if device_label else "")
            + f"Ubicación aproximada: {location or 'No disponible'}\n"
            + (f"IP: {ip}\n" if ip else "")
            + (f"Fecha y hora: {when}\n" if when else "")
            + f"\nSi eres tú, autoriza el acceso aquí (vence en 15 minutos):\n{approve_link}\n\n"
            f"Si no fuiste tú, ignora este mensaje y cambia tu contraseña."
        )
        return _send(subject, [email], text, html)

    # ── Recuperación: contraseña temporal ──
    @staticmethod
    def send_temporary_password(email: str, temp_password: str, user_name: str = '') -> bool:
        """Contraseña temporal aleatoria (recuperación de acceso)."""
        subject = "Tu contraseña temporal — Biblioteca SENA"
        inner = (
            f'<div style="border:1px dashed {GREEN};border-radius:12px;padding:18px;text-align:center;margin-top:6px;">'
            f'<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:{MUTED};">Contraseña temporal</div>'
            f'<div style="font-family:\'Courier New\',monospace;font-size:24px;font-weight:800;color:{GREEN};'
            f'margin-top:8px;word-break:break-all;">{temp_password}</div></div>'
            f'<p style="font-size:12px;color:#dc2626;margin:12px 0 0;line-height:1.5;">'
            f'Esta contraseña expira en <strong>30 minutos</strong>. El sistema te pedirá cambiarla '
            f'al iniciar sesión. No la compartas con nadie.</p>'
        )
        content = _card(
            inner,
            icon="🔓",
            heading="Recuperación de acceso",
            subtext="Usa esta contraseña para iniciar sesión una sola vez.",
        )
        html = render_email(
            subject,
            greeting_name=user_name,
            intro="Has solicitado recuperar el acceso a tu cuenta. Te generamos una contraseña temporal.",
            content_html=content,
            cta_text="Iniciar sesión",
            cta_url=f"{_base_url()}/login",
            preheader="Contraseña temporal para recuperar tu acceso",
        )
        text = (
            f"Hola {user_name},\n\n"
            f"Tu contraseña temporal es: {temp_password}\n\n"
            f"Inicia sesión con ella y el sistema te pedirá cambiarla.\n"
            f"Expira en 30 minutos. No la compartas con nadie."
        )
        return _send(subject, [email], text, html)

    # ── Notificación genérica (préstamos, reservas, multas, mantenimiento…) ──
    @staticmethod
    def send_notification(email: str, user_name: str = '', *, title: str,
                          card_subtext: str = '', rows=None, image_url: str = None,
                          icon: str = "🔔", intro: str = None, personal_message: str = None,
                          cta_text: str = "Ver en el sistema", cta_url: str = None,
                          subject: str = None, preheader: str = None) -> bool:
        """Notificación con la plantilla de marca (equivalente al diseño de referencia).

        Parámetros:
          - title         : título de la tarjeta (p. ej. "Préstamo próximo a vencer").
          - card_subtext  : frase de apoyo bajo el título.
          - rows          : lista de (etiqueta, valor). El valor admite HTML: usa
                            EmailService.status_pill("Prestado") para un estado con color.
          - image_url     : URL absoluta de la foto del elemento (opcional).
          - icon          : emoji del círculo verde de la tarjeta.
          - intro         : párrafo superior (HTML de confianza). None → texto por defecto.
          - personal_message : texto libre → bloque verde "Mensaje personalizado".
          - cta_text/cta_url : botón. cta_url None → portada del sitio.

        Ejemplo:
            EmailService.send_notification(
                aprendiz.email, aprendiz.name,
                title="Préstamo próximo a vencer",
                card_subtext="Recuerda realizar la devolución dentro del plazo establecido.",
                rows=[
                    ("Producto", "Laptop Lenovo"),
                    ("Fecha de préstamo", "10/09/2026"),
                    ("Estado", EmailService.status_pill("Prestado")),
                ],
                image_url="https://sena.newonline.digital/uploads/item_12.jpg",
                personal_message="Pásate por la biblioteca antes de las 4 p. m.",
                cta_url="https://sena.newonline.digital/aprendiz/prestamos",
            )
        """
        subject = subject or f"{title} — Biblioteca SENA"
        inner = _panel(_rows_table(rows), image_url) if rows else ""
        content = _card(inner, icon=icon, heading=_esc(title), subtext=_esc(card_subtext))
        html = render_email(
            subject,
            greeting_name=user_name,
            intro=intro or ("Te informamos que hay una actualización importante en tu registro "
                            "dentro de <strong>Biblioteca &amp; Almacén SENA</strong>."),
            content_html=content,
            personal_message=personal_message,
            cta_text=cta_text,
            cta_url=cta_url or _base_url(),
            preheader=preheader or title,
        )
        lines = [f"Hola {user_name},", "", title]
        if card_subtext:
            lines += ["", card_subtext]
        for label, value in (rows or []):
            lines.append(f"- {label}: {_strip_tags(value)}")
        if personal_message:
            lines += ["", f"Mensaje: {_strip_tags(personal_message)}"]
        lines += ["", f"Ver en el sistema: {cta_url or _base_url()}"]
        return _send(subject, [email], "\n".join(lines), html)

    # ── Legacy: enlace de recuperación con token (se mantiene por compatibilidad) ──
    @staticmethod
    def send_recovery_email(email: str, token: str) -> bool:
        """[Legacy] Enlace de recuperación con token."""
        subject = "Recuperación de contraseña — Biblioteca SENA"
        reset_link = f"{_base_url()}/reset-password?token={token}"
        content = _card(
            f'<p style="margin:0;font-size:14px;color:{TEXT};line-height:1.6;">'
            f'Pulsa el botón para elegir una nueva contraseña. El enlace caduca en '
            f'<strong>15 minutos</strong>.</p>',
            icon="🔑",
            heading="Restablecer contraseña",
        )
        html = render_email(
            subject,
            intro="Recibimos una solicitud para restablecer tu contraseña.",
            content_html=content,
            cta_text="Restablecer contraseña",
            cta_url=reset_link,
            preheader="Enlace para restablecer tu contraseña (expira en 15 min)",
        )
        text = (
            "Hola, has solicitado restablecer tu contraseña.\n"
            f"Abre este enlace: {reset_link}\n"
            "El enlace expira en 15 minutos."
        )
        return _send(subject, [email], text, html)
