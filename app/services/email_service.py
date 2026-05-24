"""Servicio de envío de correos para el sistema Biblioteca SENA.

Métodos disponibles:
  - send_verification_code         → código de verificación al registrar cuenta
  - send_password_change_code      → código para confirmar cambio de contraseña
  - send_temporary_password        → contraseña temporal aleatoria (recuperación)
  - send_recovery_email            → (legacy) link de recuperación con token
"""
from flask_mail import Message
from flask import current_app
from ..extensions import mail


# ── Plantilla HTML base ───────────────────────────────────────────────

_BASE_HTML = """\
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>{title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"
             width="560" style="background:#ffffff;border-radius:12px;overflow:hidden;
                                box-shadow:0 2px 12px rgba(0,0,0,.06);">
        <!-- Header -->
        <tr><td style="background:#39A900;padding:20px 28px;color:#ffffff;">
          <h1 style="margin:0;font-size:20px;font-weight:700;">Biblioteca SENA</h1>
          <p style="margin:4px 0 0;font-size:13px;opacity:.9;">Sistema Integral de Gestión</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px;color:#1f2937;font-size:15px;line-height:1.55;">
          {body}
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:16px 28px;color:#6b7280;font-size:12px;border-top:1px solid #e5e7eb;">
          Este es un correo automático. No respondas a este mensaje.<br>
          © {year} SENA · Biblioteca · Todos los derechos reservados.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _render(title: str, body_html: str) -> str:
    from datetime import datetime
    return _BASE_HTML.format(title=title, body=body_html, year=datetime.now().year)


def _send(subject: str, recipients: list, text_body: str, html_body: str = None) -> bool:
    """Envía un correo. Si MAIL_SERVER no está configurado, hace print."""
    try:
        if not current_app.config.get('MAIL_SERVER'):
            print(f"DEBUG EMAIL [{subject}] → {recipients}\n{text_body}\n")
            return True

        msg = Message(subject, recipients=recipients)
        msg.body = text_body
        if html_body:
            msg.html = html_body
        mail.send(msg)
        return True
    except Exception as e:
        print(f"Error enviando correo '{subject}' a {recipients}: {e}")
        return False


# ─────────────────────────  CÓDIGOS DE VERIFICACIÓN  ─────────────────

class EmailService:
    @staticmethod
    def send_verification_code(email: str, code: str, user_name: str = '') -> bool:
        """Envía código de 6 dígitos para confirmar el registro de cuenta."""
        subject = "Verifica tu cuenta — Biblioteca SENA"
        hello = f"Hola <strong>{user_name}</strong>," if user_name else "Hola,"
        body_html = f"""
          <p>{hello}</p>
          <p>Gracias por registrarte en la plataforma de la Biblioteca SENA. Para activar
             tu cuenta, ingresa el siguiente código de verificación:</p>
          <div style="margin:24px 0;padding:18px;background:#f3f4f6;border-radius:8px;text-align:center;">
            <span style="font-size:32px;letter-spacing:8px;font-weight:700;color:#39A900;">{code}</span>
          </div>
          <p style="color:#6b7280;font-size:13px;">Este código expira en <strong>15 minutos</strong>.
             Si no fuiste tú quien creó esta cuenta, simplemente ignora este mensaje.</p>
        """
        text = (
            f"Hola {user_name},\n\n"
            f"Tu código de verificación es: {code}\n\n"
            f"Este código expira en 15 minutos.\n"
            f"Si no creaste esta cuenta, ignora este mensaje."
        )
        return _send(subject, [email], text, _render(subject, body_html))

    @staticmethod
    def send_password_change_code(email: str, code: str, user_name: str = '') -> bool:
        """Envía código para confirmar el cambio de contraseña desde Configuración."""
        subject = "Confirma el cambio de tu contraseña — Biblioteca SENA"
        hello = f"Hola <strong>{user_name}</strong>," if user_name else "Hola,"
        body_html = f"""
          <p>{hello}</p>
          <p>Has solicitado cambiar la contraseña de tu cuenta. Para completar el cambio,
             ingresa el siguiente código en la plataforma:</p>
          <div style="margin:24px 0;padding:18px;background:#f3f4f6;border-radius:8px;text-align:center;">
            <span style="font-size:32px;letter-spacing:8px;font-weight:700;color:#39A900;">{code}</span>
          </div>
          <p style="color:#6b7280;font-size:13px;">Este código expira en <strong>10 minutos</strong>.
             Si no fuiste tú, cambia tu contraseña inmediatamente — alguien tiene acceso a tu cuenta.</p>
        """
        text = (
            f"Hola {user_name},\n\n"
            f"Tu código para confirmar el cambio de contraseña es: {code}\n\n"
            f"Expira en 10 minutos. Si no solicitaste este cambio, alguien tiene acceso a tu cuenta."
        )
        return _send(subject, [email], text, _render(subject, body_html))

    @staticmethod
    def send_temporary_password(email: str, temp_password: str, user_name: str = '') -> bool:
        """Envía una contraseña temporal aleatoria (recuperación de cuenta)."""
        subject = "Tu contraseña temporal — Biblioteca SENA"
        hello = f"Hola <strong>{user_name}</strong>," if user_name else "Hola,"
        body_html = f"""
          <p>{hello}</p>
          <p>Has solicitado recuperar el acceso a tu cuenta. Te hemos generado una
             contraseña temporal:</p>
          <div style="margin:24px 0;padding:18px;background:#f3f4f6;border-radius:8px;text-align:center;">
            <span style="font-family:'Courier New',monospace;font-size:24px;font-weight:700;color:#39A900;">{temp_password}</span>
          </div>
          <p>Usa esta contraseña para iniciar sesión. Por seguridad, el sistema te
             pedirá <strong>cambiarla de inmediato</strong> después de ingresar.</p>
          <p style="color:#dc2626;font-size:13px;">⚠ Esta contraseña expira en <strong>30 minutos</strong>.
             No la compartas con nadie.</p>
        """
        text = (
            f"Hola {user_name},\n\n"
            f"Tu contraseña temporal es: {temp_password}\n\n"
            f"Inicia sesión con ella y el sistema te pedirá cambiarla.\n"
            f"Expira en 30 minutos. No la compartas con nadie."
        )
        return _send(subject, [email], text, _render(subject, body_html))

    # ── Legacy (se mantiene para no romper compatibilidad con /reset-password) ──
    @staticmethod
    def send_recovery_email(email: str, token: str) -> bool:
        """[Legacy] Enlace de recuperación con token. Se mantiene por compatibilidad."""
        reset_link = f"http://localhost:3000/reset-password?token={token}"
        text = (
            f"Hola, has solicitado restablecer tu contraseña.\n"
            f"Haz clic en el siguiente enlace: {reset_link}\n"
            f"Este enlace expira en 15 minutos."
        )
        return _send("Recuperación de Contraseña - Biblioteca SENA", [email], text)
