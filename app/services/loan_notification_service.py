from datetime import datetime
from ..extensions import db
from ..models.loan import Loan
from ..models.movement import Notification
from ..models.user import User, Role


def process_loan_notifications():
    """
    Tarea del scheduler. Ejecuta dos comprobaciones:
      1. Préstamos vencidos → marca OVERDUE, notifica a Bibliotecario/Almacenista.
      2. Préstamos al 80% de su duración → notifica al usuario del préstamo.
    """
    result = {'overdue_marked': 0, 'overdue_notified': 0, 'pct80_notified': 0}
    now = datetime.utcnow()

    staff_roles = Role.query.filter(Role.name.in_(['BIBLIOTECARIO', 'ALMACENISTA'])).all()
    staff_role_ids = [r.id for r in staff_roles] if staff_roles else []

    # ── 1. Préstamos vencidos ────────────────────────────────────────────
    overdue_loans = Loan.query.filter(
        Loan.status == 'ACTIVE',
        Loan.due_date < now,
    ).all()

    for loan in overdue_loans:
        loan.status = 'OVERDUE'

        already_notified = Notification.query.filter_by(
            type='LOAN_OVERDUE', related_type='loan', related_id=loan.id
        ).first()

        if not already_notified and staff_role_ids:
            staff_users = User.query.filter(
                User.role_id.in_(staff_role_ids),
                User.is_deleted == False,
                User.is_active == True,
            ).all()
            for su in staff_users:
                db.session.add(Notification(
                    user_id=str(su.id),
                    type='LOAN_OVERDUE',
                    title='Préstamo vencido',
                    message=f'El préstamo #{loan.id} ha vencido.',
                    related_type='loan',
                    related_id=loan.id,
                ))
            result['overdue_notified'] += len(staff_users)

        result['overdue_marked'] += 1

    # ── 2. Préstamos al 80% de duración ──────────────────────────────────
    active_loans = Loan.query.filter(Loan.status == 'ACTIVE').all()

    for loan in active_loans:
        duration = (loan.due_date - loan.loan_date).total_seconds()
        if duration <= 0:
            continue

        elapsed = (now - loan.loan_date).total_seconds()
        pct = (elapsed / duration) * 100

        if pct >= 80:
            already_notified = Notification.query.filter_by(
                type='LOAN_80_PERCENT', related_type='loan', related_id=loan.id
            ).first()

            if not already_notified:
                db.session.add(Notification(
                    user_id=str(loan.user_id),
                    type='LOAN_80_PERCENT',
                    title='Préstamo próximo a vencer',
                    message=f'Tu préstamo #{loan.id} ha alcanzado el 80% de su tiempo límite. ¡Devuélvelo pronto!',
                    related_type='loan',
                    related_id=loan.id,
                ))
                result['pct80_notified'] += 1

    db.session.commit()
    return result
