"""Lógica de cola FIFO de reservas + notificaciones in-app.

Estados de Reservation:
    QUEUED   -> en cola, ítem aún no disponible para esta persona
    READY    -> ítem disponible, 15 min para reclamar
    CLAIMED  -> reclamada, ya tiene Loan asociado
    EXPIRED  -> 15 min sin reclamar (la siguiente en QUEUED se promueve)
    CANCELLED-> cancelada por el usuario

Punto de entrada del scheduler:  process_reservation_queue()
Punto de entrada al devolver:    on_item_available(item_id)
Punto de entrada al reservar:    enqueue_reservation(user_id, item_id)
"""
from datetime import datetime, timedelta
from sqlalchemy import and_

from ..extensions import db
from ..models.reservation import Reservation
from ..models.item import Item, Status
from ..models.movement import Notification
from ..models.loan import Loan

RESERVATION_HOLD_MINUTES = 15
REMINDER_INTERVAL_HOURS = 1


# ── Notificaciones ──────────────────────────────────────────────────────────
def push_notification(user_id, type_, title, message, related_type=None, related_id=None):
    n = Notification(
        user_id=str(user_id),
        type=type_,
        title=title,
        message=message,
        related_type=related_type,
        related_id=related_id,
    )
    db.session.add(n)
    return n


# ── Disponibilidad ──────────────────────────────────────────────────────────
def _available_units(item):
    """Unidades libres = stock - préstamos activos - reservas en READY."""
    from ..models.loan import LoanDetail, Loan
    active_loans = (
        db.session.query(LoanDetail)
        .join(Loan)
        .filter(LoanDetail.item_id == item.id, Loan.status == 'ACTIVE')
        .count()
    )
    ready_reservations = Reservation.query.filter_by(
        item_id=item.id, status='READY'
    ).count()
    stock = item.stock or 1
    return max(0, stock - active_loans - ready_reservations)


def is_item_available_for_loan(item):
    """¿Hay al menos una unidad libre Y nadie en READY antes que un nuevo préstamo directo?"""
    return _available_units(item) > 0


# ── Cola ────────────────────────────────────────────────────────────────────
def enqueue_reservation(user_id, item_id, admin_id=None):
    """Crea una reserva. Si hay stock libre la deja READY; si no, QUEUED."""
    item = Item.query.get(item_id)
    if not item:
        return None, "Ítem no encontrado"

    # Sanción activa (préstamo NOT_RETURNED sin levantar): bloquea cualquier
    # reserva nueva, la haga el propio usuario o el staff en su nombre, hasta
    # que un Admin la levante desde Historial de Préstamos.
    sanctioned_loan = Loan.query.filter_by(
        user_id=str(user_id), status='NOT_RETURNED', sanction_active=True
    ).first()
    if sanctioned_loan:
        motivo = sanctioned_loan.sanction_description or 'sanción activa'
        return None, (
            f"No puedes reservar: tienes una sanción activa por el préstamo #{sanctioned_loan.id} "
            f"que no se devolvió ({motivo}). Un administrador debe levantarla."
        )

    # Evitar reservas duplicadas activas del mismo usuario para el mismo ítem
    duplicate = Reservation.query.filter(
        Reservation.user_id == str(user_id),
        Reservation.item_id == item_id,
        Reservation.status.in_(['QUEUED', 'READY']),
    ).first()
    if duplicate:
        return None, "Ya tienes una reserva activa para este ítem"

    # Validar que si el elemento no tiene unidades libres, solo puede recibir 1 reserva en cola.
    if _available_units(item) <= 0:
        queued_count = Reservation.query.filter_by(
            item_id=item_id, status='QUEUED'
        ).count()
        if queued_count >= 1:
            return None, "El ítem ya tiene una reserva en espera y no admite más reservas simultáneas"

    res = Reservation(
        user_id=str(user_id),
        item_id=item_id,
        admin_id=str(admin_id) if admin_id else None,
        status='QUEUED',
    )
    db.session.add(res)
    db.session.flush()

    if _available_units(item) > 0:
        _promote_to_ready(res, item)
    else:
        push_notification(
            user_id, 'RESERVATION_QUEUED',
            'Reserva en cola',
            f'Estás en la cola para "{item.name}". Te avisaremos cuando esté disponible.',
            related_type='reservation', related_id=res.id,
        )

    # Notificar a Almacenistas y Bibliotecarios de la nueva reserva pendiente de préstamo
    try:
        from ..models.user import User, Role
        apprentice = User.query.get(str(user_id))
        apprentice_name = apprentice.name if apprentice else "Un aprendiz"
        
        staff_users = (
            User.query.join(Role)
            .filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA']))
            .all()
        )
        for staff in staff_users:
            push_notification(
                staff.id, 'PENDING_APPROVAL_RESERVATION',
                'Nueva reserva pendiente',
                f'{apprentice_name} ha realizado una reserva y está esperando tu aprobación al préstamo.',
                related_type='reservation', related_id=res.id,
            )
    except Exception as e:
        print(f"Error enviando notificación al staff: {e}")

    db.session.commit()
    return res, None


def _promote_to_ready(reservation, item):
    now = datetime.utcnow()
    reservation.status = 'READY'
    reservation.ready_at = now
    reservation.expiration_date = now + timedelta(minutes=RESERVATION_HOLD_MINUTES)
    reservation.last_reminder_sent = now  # arranca el reloj para el próximo recordatorio

    push_notification(
        reservation.user_id, 'RESERVATION_READY',
        f'¡{item.name} está disponible!',
        f'Tu reserva está lista. Tienes {RESERVATION_HOLD_MINUTES} minutos para reclamarla.',
        related_type='reservation', related_id=reservation.id,
    )


def on_item_available(item_id):
    """Llamar al devolver un préstamo o liberar stock.
    Promueve hasta N reservas en QUEUED (donde N = unidades libres).
    """
    item = Item.query.get(item_id)
    if not item:
        return

    promoted = 0
    while _available_units(item) > 0:
        next_res = (
            Reservation.query.filter_by(item_id=item_id, status='QUEUED')
            .order_by(Reservation.reservation_date.asc())
            .first()
        )
        if not next_res:
            break
        _promote_to_ready(next_res, item)
        promoted += 1

    if promoted:
        db.session.flush()
    return promoted


# ── Scheduler tick ──────────────────────────────────────────────────────────
def process_reservation_queue():
    """Job recurrente. Hace tres cosas:
      1) Expira reservas READY que pasaron los 15 min.
      2) Promueve QUEUED -> READY si hay stock libre.
      3) Manda recordatorios horarios a las que sigan READY.
    """
    now = datetime.utcnow()
    expired_count = 0
    reminders = 0
    promoted = 0

    # 1) Expirar
    overdue = Reservation.query.filter(
        Reservation.status == 'READY',
        Reservation.expiration_date <= now,
    ).all()
    affected_items = set()
    for r in overdue:
        r.status = 'EXPIRED'
        item = Item.query.get(r.item_id)
        item_name = item.name if item else 'el ítem'
        push_notification(
            r.user_id, 'RESERVATION_EXPIRED',
            'Tu reserva expiró',
            f'No reclamaste "{item_name}" a tiempo. Pasó al siguiente en la cola.',
            related_type='reservation', related_id=r.id,
        )
        affected_items.add(r.item_id)
        expired_count += 1

    # 2) Promover por cada ítem afectado (y por cualquier otro que tenga QUEUED)
    queued_items = {
        r.item_id for r in
        Reservation.query.filter_by(status='QUEUED').with_entities(Reservation.item_id).all()
    }
    for item_id in affected_items | queued_items:
        item = Item.query.get(item_id)
        if not item:
            continue
        while _available_units(item) > 0:
            nxt = (
                Reservation.query.filter_by(item_id=item_id, status='QUEUED')
                .order_by(Reservation.reservation_date.asc())
                .first()
            )
            if not nxt:
                break
            _promote_to_ready(nxt, item)
            promoted += 1

    # 2.5) Recordatorio de 8 minutos para el Aprendiz
    ready_reservations_8m = Reservation.query.filter(
        Reservation.status == 'READY',
        Reservation.eight_minute_reminder_sent == False,
        Reservation.expiration_date > now
    ).all()
    for r in ready_reservations_8m:
        remaining = r.expiration_date - now
        remaining_minutes = remaining.total_seconds() / 60.0
        if remaining_minutes <= 8.0:
            item = Item.query.get(r.item_id)
            item_name = item.name if item else 'tu ítem'
            push_notification(
                r.user_id, 'RESERVATION_CLOSE_TO_EXPIRY',
                'Reserva próxima a vencer',
                f'Tu producto "{item_name}" está próximo a vencer (faltan {int(remaining_minutes)} minutos). Pasa a recogerlo pronto.',
                related_type='reservation', related_id=r.id,
            )
            r.eight_minute_reminder_sent = True

    # 3) Recordatorios horarios para las que siguen READY
    threshold = now - timedelta(hours=REMINDER_INTERVAL_HOURS)
    pending_reminders = Reservation.query.filter(
        Reservation.status == 'READY',
        Reservation.expiration_date > now,
        Reservation.last_reminder_sent <= threshold,
    ).all()
    for r in pending_reminders:
        item = Item.query.get(r.item_id)
        item_name = item.name if item else 'tu ítem'
        remaining = r.expiration_date - now
        hrs = max(1, int(remaining.total_seconds() // 3600))
        push_notification(
            r.user_id, 'RESERVATION_REMINDER',
            f'¿Aún quieres {item_name}?',
            f'Tu reserva expira en {hrs} {"hora" if hrs == 1 else "horas"}. Pasa a recogerla.',
            related_type='reservation', related_id=r.id,
        )
        r.last_reminder_sent = now
        reminders += 1

    db.session.commit()
    return {'expired': expired_count, 'promoted': promoted, 'reminders': reminders}
