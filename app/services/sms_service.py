"""Envío de SMS para el sistema Biblioteca & Almacén SENA.

Se usa para el código 2FA por celular. Igual que el servicio de correo, si no
hay proveedor configurado (SMS_PROVIDER vacío o 'console') simplemente imprime
el mensaje por consola y devuelve True — así el flujo funciona en desarrollo
sin cuenta de ningún proveedor.

Proveedores soportados:
  - console  (por defecto)  → imprime, no envía nada
  - twilio                  → API REST de Twilio (necesita SID + token + remitente)

Variables de entorno (ver .env.example):
  SMS_PROVIDER                    console | twilio
  SMS_DEFAULT_COUNTRY_CODE        57 (Colombia) — para pasar '3001234567' a E.164
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_FROM                     remitente, ej. +12025550123
  TWILIO_MESSAGING_SERVICE_SID    alternativa a TWILIO_FROM
"""
import re

import requests
from flask import current_app


def _cfg(key, default=None):
    return current_app.config.get(key, default)


def _to_e164(phone: str, default_cc: str = "57") -> str:
    """Normaliza un teléfono a formato E.164 (+<indicativo><número>)."""
    raw = (phone or "").strip()
    if raw.startswith("+"):
        return "+" + re.sub(r"\D", "", raw)
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    # Ya trae indicativo de país (ej. 57 + 10 dígitos)
    if digits.startswith(default_cc) and len(digits) > 10:
        return "+" + digits
    return "+" + default_cc + digits


def _send(to: str, body: str) -> bool:
    """Envía un SMS. Devuelve True si se envió (o se imprimió en modo consola)."""
    provider = (_cfg("SMS_PROVIDER") or "console").strip().lower()
    default_cc = str(_cfg("SMS_DEFAULT_COUNTRY_CODE") or "57")
    to_e164 = _to_e164(to, default_cc)

    if not to_e164:
        print(f"[sms] número inválido: {to!r}")
        return False

    if provider in ("", "console", "none", "dev"):
        print(f"DEBUG SMS → {to_e164}\n{body}\n")
        return True

    if provider == "twilio":
        sid = _cfg("TWILIO_ACCOUNT_SID")
        token = _cfg("TWILIO_AUTH_TOKEN")
        from_number = _cfg("TWILIO_FROM")
        msg_service = _cfg("TWILIO_MESSAGING_SERVICE_SID")
        if not sid or not token or not (from_number or msg_service):
            print("[sms] Twilio mal configurado (falta SID/token/remitente).")
            return False
        data = {"To": to_e164, "Body": body}
        if msg_service:
            data["MessagingServiceSid"] = msg_service
        else:
            data["From"] = from_number
        try:
            resp = requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data=data, auth=(sid, token), timeout=10,
            )
            if resp.status_code in (200, 201):
                return True
            print(f"[sms] Twilio respondió {resp.status_code}: {resp.text[:300]}")
            return False
        except Exception as e:
            print(f"[sms] error llamando a Twilio: {e}")
            return False

    print(f"[sms] proveedor no soportado: {provider!r}")
    return False


class SmsService:

    @staticmethod
    def send_2fa_code(phone: str, code: str) -> bool:
        """Envía el código de verificación en dos pasos por SMS."""
        body = (
            f"Biblioteca & Almacen SENA\n"
            f"Tu codigo de verificacion es: {code}\n"
            f"Vence en 5 minutos. No lo compartas con nadie."
        )
        return _send(phone, body)
