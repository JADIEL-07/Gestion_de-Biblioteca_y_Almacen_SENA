from datetime import datetime
from .. import db


class UserPreference(db.Model):
    """Preferencias de notificaciones, alertas y privacidad por usuario."""
    __tablename__ = 'user_preferences'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.String(50), db.ForeignKey('users.id'), unique=True, nullable=False)

    # ── Notificaciones ───────────────────────────────────────
    notif_loan_reminder   = db.Column(db.Boolean, default=True)
    notif_loan_overdue    = db.Column(db.Boolean, default=True)
    notif_reservation     = db.Column(db.Boolean, default=True)
    notif_new_items       = db.Column(db.Boolean, default=False)
    notif_weekly_summary  = db.Column(db.Boolean, default=True)
    notif_promotions      = db.Column(db.Boolean, default=False)

    # ── Canales ──────────────────────────────────────────────
    channel_email         = db.Column(db.Boolean, default=True)
    channel_inapp         = db.Column(db.Boolean, default=True)
    channel_sms           = db.Column(db.Boolean, default=False)

    # ── Alertas ──────────────────────────────────────────────
    alert_reminder_days   = db.Column(db.Integer, default=2)
    quiet_start           = db.Column(db.String(5), default='22:00')   # HH:MM
    quiet_end             = db.Column(db.String(5), default='07:00')

    # ── Privacidad ───────────────────────────────────────────
    privacy_profile_visible = db.Column(db.Boolean, default=True)
    privacy_show_activity   = db.Column(db.Boolean, default=False)
    privacy_analytics       = db.Column(db.Boolean, default=True)

    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EmailChangeToken(db.Model):
    """Token temporal para verificar cambio de correo electrónico."""
    __tablename__ = 'email_change_tokens'

    id = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.String(50), db.ForeignKey('users.id'), nullable=False)
    new_email   = db.Column(db.String(120), nullable=False)
    token_hash  = db.Column(db.String(255), nullable=False)
    expires_at  = db.Column(db.DateTime, nullable=False)
    is_used     = db.Column(db.Boolean, default=False)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
