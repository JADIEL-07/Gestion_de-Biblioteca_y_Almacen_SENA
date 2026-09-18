"""Pruebas de los modelos con pytest (fixtures en tests/conftest.py).

Ejecutar:  python -m pytest tests/test_models_pytest.py
"""
import json
import time
from datetime import datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import (
    AILearnedResponse, AIResponseFeedback, AIUnansweredQuery, AssistantThread,
    AuditLog, Category, Dependency, EmailChangeToken, FormationProgram, Item,
    ItemOutput, Loan, LoanDetail, Location, Maintenance, Movement, Notification,
    OutputStatus, OutputType, PasswordResetToken, PendingRegistration,
    RefreshToken, Reservation, Role, SavedItem, SparePartRequest, Status,
    StaffMessage, Supplier, Ticket, TicketMessage, TrustedDevice, User,
    UserPreference, VerificationCode,
)

pytestmark = pytest.mark.models
NOW = datetime.utcnow


def commit_fails(session, *objs):
    """Añade objetos y comprueba que la base los rechaza (restricción violada)."""
    session.add_all(objs)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


# ── Valores por defecto ─────────────────────────────────────────────────────
class TestDefaults:
    def test_user(self, user):
        assert (user.is_active, user.is_deleted, user.is_verified) == (True, False, False)
        assert (user.is_blocked, user.must_change_password, user.is_2fa_enabled) == (False, False, False)
        assert user.failed_attempts == 0

    def test_item(self, item):
        assert item.stock == 1
        assert item.is_deleted is False
        assert item.created_at is not None

    def test_loan(self, session, user):
        loan = Loan(user_id=user.id, due_date=NOW() + timedelta(days=3))
        session.add(loan); session.commit()
        assert loan.status == "ACTIVE"
        assert loan.fine_amount == 0.0
        assert loan.sanction_active is False
        assert loan.return_date is None and loan.loan_date is not None

    def test_reservation_generates_unique_tokens(self, session, user, item):
        a, b = (Reservation(user_id=user.id, item_id=item.id) for _ in range(2))
        session.add_all([a, b]); session.commit()
        assert a.status == "QUEUED" and a.is_deleted is False
        assert a.eight_minute_reminder_sent is False
        assert len(a.token) >= 32 and a.token != b.token

    def test_maintenance(self, session, user, item):
        m = Maintenance(item_id=item.id, reported_by=user.id, failure_description="falla")
        session.add(m); session.commit()
        assert (m.severity, m.maintenance_type, m.status) == ("LOW", "CORRECTIVE", "PENDING")
        assert m.cost == 0.0 and m.requires_replacement is False

    def test_ticket(self, session, user):
        t = Ticket(user_id=user.id, subject="s", description="d")
        session.add(t); session.commit()
        assert (t.severity, t.status) == ("MEDIUM", "OPEN")
        assert t.satisfaction is None and t.source_thread_id is None and t.is_deleted is False

    def test_notification(self, session, user):
        n = Notification(user_id=user.id, message="m")
        session.add(n); session.commit()
        assert n.is_read is False and n.date is not None

    def test_user_preference(self, session, user):
        p = UserPreference(user_id=user.id)
        session.add(p); session.commit()
        assert (p.notif_loan_reminder, p.notif_promotions) == (True, False)
        assert (p.channel_email, p.channel_inapp, p.channel_sms) == (True, True, False)
        assert (p.alert_reminder_days, p.quiet_start, p.quiet_end) == (2, "22:00", "07:00")

    def test_assistant_thread(self, session, user):
        t = AssistantThread(id="thread_1", user_id=user.id)
        session.add(t); session.commit()
        assert t.title == "Nueva conversación"
        assert json.loads(t.messages) == []

    def test_ai_learned_response(self, session):
        r = AILearnedResponse(query_text="q", query_keywords="k", response_text="r")
        session.add(r); session.commit()
        assert (r.use_count, r.positive_feedback, r.negative_feedback) == (0, 0, 0)
        assert r.source == "gemini" and r.role is None

    def test_tokens_and_codes(self, session, user):
        rt = RefreshToken(user_id=user.id, token_hash="h", expires_at=NOW())
        vc = VerificationCode(user_id=user.id, purpose="ACCOUNT_VERIFY", code_hash="h", expires_at=NOW())
        pr = PasswordResetToken(user_id=user.id, token_hash="h", expires_at=NOW())
        session.add_all([rt, vc, pr]); session.commit()
        assert rt.is_revoked is False
        assert (vc.is_used, vc.attempts) == (False, 0)
        assert pr.is_used is False


# ── Campos obligatorios ─────────────────────────────────────────────────────
class TestRequiredFields:
    @pytest.mark.parametrize("missing", ["name", "email", "password", "document_type", "role_id"])
    def test_user(self, session, make_role, missing):
        kw = dict(id="9", document_type="CC", name="n", email="m@t.com", password="x", role_id=make_role().id)
        kw.pop(missing)
        commit_fails(session, User(**kw))

    @pytest.mark.parametrize("missing", ["name", "category_id", "location_id", "status_id"])
    def test_item(self, session, make_item, missing):
        base = make_item()
        kw = dict(name="x", code="NUEVO", category_id=base.category_id,
                  location_id=base.location_id, status_id=base.status_id)
        kw.pop(missing)
        commit_fails(session, Item(**kw))

    def test_loan_needs_due_date(self, session, user):
        commit_fails(session, Loan(user_id=user.id))

    def test_maintenance_needs_failure_description(self, session, user, item):
        commit_fails(session, Maintenance(item_id=item.id, reported_by=user.id))

    def test_ticket_needs_description(self, session, user):
        commit_fails(session, Ticket(user_id=user.id, subject="s"))

    def test_ticket_message_needs_body(self, session, user):
        t = Ticket(user_id=user.id, subject="s", description="d")
        session.add(t); session.commit()
        commit_fails(session, TicketMessage(ticket_id=t.id, sender_id=user.id))

    def test_notification_needs_message(self, session, user):
        commit_fails(session, Notification(user_id=user.id))

    def test_audit_log_needs_action(self, session):
        commit_fails(session, AuditLog())

    def test_item_output_needs_type(self, session, user, item):
        commit_fails(session, ItemOutput(item_id=item.id, user_id=user.id))

    def test_spare_part_needs_invoice(self, session, user, item):
        commit_fails(session, SparePartRequest(item_id=item.id, requested_by=user.id,
                                               reason="r", cost=1, supplier="P"))

    def test_learned_response_needs_text(self, session):
        commit_fails(session, AILearnedResponse(query_text="q"))

    def test_feedback_needs_useful_flag(self, session):
        commit_fails(session, AIResponseFeedback(query_text="x"))


# ── Unicidad ────────────────────────────────────────────────────────────────
class TestUniqueness:
    @pytest.mark.parametrize("model", [Role, Dependency, Category, Location, Status])
    def test_unique_name(self, session, model):
        session.add(model(name="repetido")); session.commit()
        commit_fails(session, model(name="repetido"))

    def test_user_email(self, session, make_user):
        make_user(email="dup@t.com")
        with pytest.raises(IntegrityError):
            make_user(email="dup@t.com")

    def test_item_code(self, session, make_item):
        make_item(code="QR1")
        with pytest.raises(IntegrityError):
            make_item(code="QR1")

    def test_reservation_token(self, session, user, item):
        session.add(Reservation(user_id=user.id, item_id=item.id, token="T")); session.commit()
        commit_fails(session, Reservation(user_id=user.id, item_id=item.id, token="T"))

    def test_refresh_token_hash(self, session, user):
        session.add(RefreshToken(user_id=user.id, token_hash="h", expires_at=NOW())); session.commit()
        commit_fails(session, RefreshToken(user_id=user.id, token_hash="h", expires_at=NOW()))

    def test_one_preference_per_user(self, session, user):
        session.add(UserPreference(user_id=user.id)); session.commit()
        commit_fails(session, UserPreference(user_id=user.id))

    def test_saved_item_once_per_user(self, session, user, item):
        session.add(SavedItem(user_id=user.id, item_id=item.id)); session.commit()
        commit_fails(session, SavedItem(user_id=user.id, item_id=item.id))

    def test_trusted_device_unique_per_user_but_not_across_users(self, session, make_user):
        a, b = make_user(), make_user()
        session.add(TrustedDevice(user_id=a.id, device_id="d")); session.commit()
        commit_fails(session, TrustedDevice(user_id=a.id, device_id="d"))
        session.add(TrustedDevice(user_id=b.id, device_id="d")); session.commit()

    def test_pending_registration_email(self, session):
        def make():
            return PendingRegistration(email="a@t.com", document_number="1", payload="{}",
                                       code_hash="h", expires_at=NOW())
        session.add(make()); session.commit()
        commit_fails(session, make())


# ── Llaves foráneas ─────────────────────────────────────────────────────────
class TestForeignKeys:
    def test_user_role(self, session):
        commit_fails(session, User(id="8", document_type="CC", name="n", email="z@t.com",
                                   password="x", role_id=99999))

    @pytest.mark.parametrize("make", [
        lambda: Loan(user_id="fantasma", due_date=NOW()),
        lambda: Notification(user_id="fantasma", message="m"),
        lambda: SavedItem(user_id="fantasma", item_id=1),
        lambda: AssistantThread(id="t", user_id="fantasma"),
        lambda: Ticket(user_id="fantasma", subject="s", description="d"),
    ], ids=["loan", "notification", "saved_item", "assistant_thread", "ticket"])
    def test_user_must_exist(self, session, make):
        commit_fails(session, make())

    def test_category_dependency(self, session):
        commit_fails(session, Category(name="c", dependency_id=999))

    def test_loan_detail_needs_existing_loan_and_item(self, session, item):
        commit_fails(session, LoanDetail(item_id=item.id))
        commit_fails(session, LoanDetail(loan_id=999, item_id=item.id))


# ── Relaciones ──────────────────────────────────────────────────────────────
class TestRelationships:
    def test_role_users(self, make_user, make_role):
        u = make_user("ADMIN")
        assert u.role.name == "ADMIN" and u in make_role("ADMIN").users

    def test_dependency_links(self, session, make_user):
        dep = Dependency(name="ALMACEN"); session.add(dep); session.commit()
        loc = Location(name="Bodega", dependency_id=dep.id)
        usr = make_user("ALMACENISTA", dependency_id=dep.id)
        session.add(loc); session.commit()
        assert loc.dependency_obj.name == "ALMACEN"
        assert usr.dependency_obj.id == dep.id
        assert usr in dep.users and loc in dep.locations

    def test_item_links(self, item):
        assert item.category.name == "Categoría"
        assert item.location.name == "Ubicación"
        assert item.status_obj.name == "AVAILABLE"
        assert item in item.category.items
        for attr in ("movements", "maintenance_records", "reservations", "outputs",
                     "loan_details", "spare_part_requests"):
            assert list(getattr(item, attr)) == [], attr

    def test_supplier(self, session, make_item):
        s = Supplier(name="Proveedor"); session.add(s); session.commit()
        assert make_item(supplier_id=s.id).supplier.name == "Proveedor"

    def test_loan_details_both_ways(self, session, user, item):
        loan = Loan(user_id=user.id, due_date=NOW()); session.add(loan); session.commit()
        d = LoanDetail(loan_id=loan.id, item_id=item.id, delivery_status="BUENO")
        session.add(d); session.commit()
        assert loan.details[0].item.id == item.id
        assert d.loan.id == loan.id
        assert item.loan_details[0].loan_id == loan.id

    def test_ticket_reporter_and_assignee_use_distinct_fks(self, session, make_user):
        reporter, support = make_user(), make_user("SOPORTE")
        t = Ticket(user_id=reporter.id, assigned_to=support.id, subject="s", description="d")
        session.add(t); session.commit()
        assert (t.reporter.id, t.assignee.id) == (reporter.id, support.id)
        assert t in reporter.tickets_created and t in support.tickets_assigned

    def test_deleting_a_ticket_deletes_its_messages(self, session, user):
        t = Ticket(user_id=user.id, subject="s", description="d"); session.add(t); session.commit()
        session.add(TicketMessage(ticket_id=t.id, sender_id=user.id, body="hola")); session.commit()
        assert t.messages.count() == 1
        session.delete(t); session.commit()
        assert TicketMessage.query.count() == 0

    def test_staff_message_parties(self, session, make_user):
        a, b = make_user("BIBLIOTECARIO"), make_user("ALMACENISTA")
        m = StaffMessage(sender_id=a.id, receiver_id=b.id, body="hey")
        session.add(m); session.commit()
        assert (m.sender.id, m.receiver.id, m.is_read) == (a.id, b.id, False)

    def test_audit_log_backref(self, session, user):
        a = AuditLog(user_id=user.id, action="LOGIN_SUCCESS")
        session.add_all([a, AuditLog(action="LOGIN_FAILED")]); session.commit()  # user_id nulo permitido
        assert a in user.audit_logs

    def test_refresh_token_backref(self, session, user):
        t = RefreshToken(user_id=user.id, token_hash="h", expires_at=NOW())
        session.add(t); session.commit()
        assert t in user.refresh_tokens

    def test_movement(self, session, user, item):
        m = Movement(item_id=item.id, user_id=user.id, movement_type="LOAN")
        session.add(m); session.commit()
        assert m in item.movements

    def test_spare_part_links(self, session, user, item):
        s = SparePartRequest(item_id=item.id, requested_by=user.id, reason="r",
                             cost=10.5, supplier="P", invoice_image="data:x")
        session.add(s); session.commit()
        assert s.status == "PENDING"
        assert s in item.spare_part_requests and s in user.spare_part_requests
        assert "SparePartRequest" in repr(s)

    def test_shadow_owner_self_reference(self, make_user):
        admin = make_user("ADMIN")
        assert make_user(shadow_owner_id=admin.id).shadow_owner_id == admin.id

    def test_formation_program_string_id(self, session):
        session.add(FormationProgram(id="2500001", name="ADSO")); session.commit()
        assert FormationProgram.query.get("2500001").name == "ADSO"


# ── Comportamiento propio de cada modelo ────────────────────────────────────
class TestBehaviour:
    def test_updated_at_moves_on_update(self, make_role, session):
        role = make_role("X"); before = role.updated_at
        time.sleep(0.01)
        role.name = "Y"; session.commit()
        assert role.updated_at > before

    def test_soft_delete_keeps_the_row(self, session, item):
        item.is_deleted = True; session.commit()
        assert Item.query.count() == 1
        assert Item.query.filter_by(is_deleted=False).count() == 0

    def test_audit_log_timestamp_is_utc(self, session):
        a = AuditLog(action="X"); session.add(a); session.commit()
        assert abs((a.created_at - datetime.utcnow()).total_seconds()) < 60

    def test_maintenance_resolution_time(self, session, user, item):
        m = Maintenance(item_id=item.id, reported_by=user.id, failure_description="f")
        session.add(m); session.commit()
        assert m.resolution_time is None
        m.start_date, m.end_date = datetime(2026, 1, 1), datetime(2026, 1, 3)
        assert m.resolution_time == timedelta(days=2)

    def test_item_output_defaults_and_to_dict(self, session, user, item):
        o = ItemOutput(item_id=item.id, user_id=user.id, type=OutputType.MAINTENANCE)
        session.add(o); session.commit()
        assert o.status == OutputStatus.ACTIVE
        d = o.to_dict()
        assert (d["item_code"], d["user_name"]) == (item.code, user.name)
        assert d["actual_return_date"] is None
        json.dumps(d)  # debe ser serializable

    def test_loan_sanction_fields_roundtrip(self, session, make_user):
        admin, student = make_user("ADMIN"), make_user()
        loan = Loan(user_id=student.id, due_date=NOW(), sanction_type="DAYS", sanction_days=7,
                    sanction_active=True, sanction_description="no devolvió",
                    sanction_created_at=NOW(), sanction_lifted_by=admin.id)
        session.add(loan); session.commit()
        stored = Loan.query.get(loan.id)
        assert (stored.sanction_days, stored.sanction_active, stored.sanction_lifted_by) == (7, True, admin.id)

    def test_ticket_message_media(self, session, user):
        t = Ticket(user_id=user.id, subject="s", description="d"); session.add(t); session.commit()
        m = TicketMessage(ticket_id=t.id, sender_id=user.id, body="",
                          media_url="data:image/png;base64,AA", media_type="image")
        session.add(m); session.commit()
        assert (m.media_type, m.is_read) == ("image", False)

    def test_assistant_thread_stores_unicode_json(self, session, user):
        msgs = [{"id": "1", "text": "hola ñandú 😀"}]
        session.add(AssistantThread(id="thread_2", user_id=user.id, messages=json.dumps(msgs)))
        session.commit()
        assert json.loads(AssistantThread.query.get("thread_2").messages) == msgs

    def test_ai_reprs(self, session):
        f = AIResponseFeedback(useful=True, query_text="q")
        l = AILearnedResponse(query_text="pregunta larga de prueba", query_keywords="k", response_text="r")
        u = AIUnansweredQuery(query_text="q")
        session.add_all([f, l, u]); session.commit()
        assert u.resolved is False
        assert "👍" in repr(f) and "AILearnedResponse" in repr(l)

    def test_email_change_token(self, session, user):
        t = EmailChangeToken(user_id=user.id, new_email="n@t.com", token_hash="h", expires_at=NOW())
        session.add(t); session.commit()
        assert t.is_used is False

    def test_pending_registration_attempts(self, session):
        p = PendingRegistration(email="p@t.com", document_number="1", payload="{}",
                                code_hash="h", expires_at=NOW())
        session.add(p); session.commit()
        assert p.attempts == 0

    @pytest.mark.parametrize("payload", ["'; DROP TABLE users; --", "<script>alert(1)</script>", "𝓤𝓷𝓲𝓬𝓸𝓭𝓮 ñ é 日本語", "x" * 5000])
    def test_hostile_text_is_stored_verbatim(self, session, user, payload):
        n = Notification(user_id=user.id, message=payload)
        session.add(n); session.commit()
        assert Notification.query.get(n.id).message == payload
        assert User.query.count() == 1
