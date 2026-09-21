"""Pruebas de los modelos de SQLAlchemy (SQLite en memoria, con FKs activadas).

Ejecutar desde la raíz:  python -m unittest tests.test_models -v
"""
import json
import os
import time
import unittest
from datetime import datetime, timedelta


from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from app import create_app
from app.extensions import db
from app.models import (
    Dependency, User, Role, FormationProgram, Item, Category, Location, Status,
    Supplier, Loan, LoanDetail, Reservation, Maintenance, AuditLog,
    RefreshToken, PasswordResetToken, Movement, Notification, Ticket,
    TicketMessage, StaffMessage, ItemOutput, OutputType, OutputStatus,
    AILearnedResponse, AIUnansweredQuery, AIResponseFeedback, SparePartRequest,
    AssistantThread, UserPreference, EmailChangeToken, VerificationCode,
    PendingRegistration, TrustedDevice, SavedItem,
)


@event.listens_for(Engine, "connect")
def _fk_on(dbapi_conn, _):
    # SQLite no valida llaves foráneas salvo que se pida — Postgres sí.
    if dbapi_conn.__class__.__module__.startswith("sqlite3"):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")


class ModelTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()

    def setUp(self):
        self.ctx = self.app.app_context()
        self.ctx.push()
        db.drop_all()
        db.create_all()
        self.n = 0

    def tearDown(self):
        db.session.remove()
        self.ctx.pop()

    # ── fábricas ────────────────────────────────────────────
    def uid(self):
        self.n += 1
        return self.n

    def role(self, name="APRENDIZ"):
        r = Role.query.filter_by(name=name).first() or Role(name=name)
        db.session.add(r); db.session.commit()
        return r

    def user(self, role="APRENDIZ", **kw):
        n = self.uid()
        u = User(id=kw.pop("id", str(1000 + n)), document_type="CC", name=f"U{n}",
                 email=kw.pop("email", f"u{n}@t.com"), password="x",
                 role_id=self.role(role).id, **kw)
        db.session.add(u); db.session.commit()
        return u

    def item(self, **kw):
        n = self.uid()
        cat = Category.query.first() or Category(name="Cat")
        loc = Location.query.first() or Location(name="Loc")
        st = Status.query.first() or Status(name="DISPONIBLE")
        db.session.add_all([cat, loc, st]); db.session.commit()
        i = Item(name=f"I{n}", code=kw.pop("code", f"C{n}"), category_id=cat.id,
                 location_id=loc.id, status_id=st.id, **kw)
        db.session.add(i); db.session.commit()
        return i


class TestBaseAndDependency(ModelTestCase):
    def test_timestamps_autofill(self):
        d = Dependency(name="BIBLIOTECA"); db.session.add(d); db.session.commit()
        self.assertIsNotNone(d.created_at)
        self.assertIsNotNone(d.updated_at)

    def test_updated_at_changes_on_update(self):
        r = self.role("X"); before = r.updated_at
        time.sleep(0.01)
        r.name = "Y"; db.session.commit()
        self.assertGreater(r.updated_at, before)

    def test_dependency_name_unique(self):
        db.session.add(Dependency(name="A")); db.session.commit()
        db.session.add(Dependency(name="A"))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_dependency_relationships(self):
        d = Dependency(name="ALMACEN"); db.session.add(d); db.session.commit()
        loc = Location(name="Bodega", dependency_id=d.id)
        u = self.user("ALMACENISTA", dependency_id=d.id)
        db.session.add(loc); db.session.commit()
        self.assertEqual(loc.dependency_obj.name, "ALMACEN")
        self.assertEqual(u.dependency_obj.id, d.id)
        self.assertIn(u, d.users)
        self.assertIn(loc, d.locations)


class TestUserRole(ModelTestCase):
    def test_defaults(self):
        u = self.user()
        self.assertTrue(u.is_active)
        self.assertFalse(u.is_deleted)
        self.assertFalse(u.is_verified)
        self.assertFalse(u.is_blocked)
        self.assertFalse(u.must_change_password)
        self.assertFalse(u.is_2fa_enabled)
        self.assertEqual(u.failed_attempts, 0)

    def test_role_backref(self):
        u = self.user("ADMIN")
        self.assertEqual(u.role.name, "ADMIN")
        self.assertIn(u, self.role("ADMIN").users)

    def test_email_unique(self):
        self.user(email="dup@t.com")
        with self.assertRaises(IntegrityError):
            self.user(email="dup@t.com")

    def test_role_name_unique(self):
        db.session.add(Role(name="R")); db.session.commit()
        db.session.add(Role(name="R"))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_required_fields(self):
        for missing in ("name", "email", "password", "document_type", "role_id"):
            db.session.rollback()
            kw = dict(id="9", document_type="CC", name="n", email="m@t.com",
                      password="x", role_id=self.role().id)
            kw.pop(missing)
            db.session.add(User(**kw))
            with self.assertRaises(IntegrityError, msg=missing):
                db.session.commit()

    def test_role_fk_enforced(self):
        db.session.add(User(id="8", document_type="CC", name="n", email="z@t.com",
                            password="x", role_id=99999))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_shadow_owner_self_reference(self):
        admin = self.user("ADMIN")
        shadow = self.user(shadow_owner_id=admin.id)
        self.assertEqual(shadow.shadow_owner_id, admin.id)

    def test_ticket_relationships_use_distinct_fks(self):
        reporter, support = self.user(), self.user("SOPORTE")
        t = Ticket(user_id=reporter.id, assigned_to=support.id, subject="s", description="d")
        db.session.add(t); db.session.commit()
        self.assertEqual(t.reporter.id, reporter.id)
        self.assertEqual(t.assignee.id, support.id)
        self.assertIn(t, reporter.tickets_created)
        self.assertIn(t, support.tickets_assigned)

    def test_formation_program(self):
        db.session.add(FormationProgram(id="2500001", name="ADSO")); db.session.commit()
        self.assertEqual(FormationProgram.query.get("2500001").name, "ADSO")


class TestItemCatalog(ModelTestCase):
    def test_item_defaults(self):
        i = self.item()
        self.assertEqual(i.stock, 1)
        self.assertFalse(i.is_deleted)
        self.assertIsNotNone(i.created_at)

    def test_item_relations(self):
        i = self.item()
        self.assertEqual(i.category.name, "Cat")
        self.assertEqual(i.location.name, "Loc")
        self.assertEqual(i.status_obj.name, "DISPONIBLE")
        self.assertIn(i, i.category.items)

    def test_item_code_unique(self):
        self.item(code="QR1")
        with self.assertRaises(IntegrityError):
            self.item(code="QR1")

    def test_item_required_fks(self):
        for missing in ("category_id", "location_id", "status_id"):
            db.session.rollback()
            i0 = self.item()
            kw = dict(name="x", code=f"Z{missing}", category_id=i0.category_id,
                      location_id=i0.location_id, status_id=i0.status_id)
            kw.pop(missing)
            db.session.add(Item(**kw))
            with self.assertRaises(IntegrityError, msg=missing):
                db.session.commit()

    def test_item_name_required(self):
        i0 = self.item()
        db.session.add(Item(code="NN", category_id=i0.category_id,
                            location_id=i0.location_id, status_id=i0.status_id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_category_location_status_unique_names(self):
        for model in (Category, Location, Status):
            db.session.rollback()
            db.session.add(model(name="dup")); db.session.commit()
            db.session.add(model(name="dup"))
            with self.assertRaises(IntegrityError, msg=model.__name__):
                db.session.commit()

    def test_category_and_location_dependency_nullable(self):
        db.session.add_all([Category(name="c"), Location(name="l")]); db.session.commit()
        self.assertIsNone(Category.query.first().dependency_id)
        self.assertIsNone(Location.query.first().dependency_id)

    def test_dependency_fk_enforced_on_category(self):
        db.session.add(Category(name="c", dependency_id=999))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_supplier(self):
        s = Supplier(name="Prov"); db.session.add(s); db.session.commit()
        i = self.item(supplier_id=s.id)
        self.assertEqual(i.supplier.name, "Prov")

    def test_soft_delete_keeps_row(self):
        i = self.item(); i.is_deleted = True; db.session.commit()
        self.assertEqual(Item.query.count(), 1)
        self.assertEqual(Item.query.filter_by(is_deleted=False).count(), 0)

    def test_item_relations_lists(self):
        i = self.item()
        for attr in ("movements", "maintenance_records", "reservations", "outputs",
                     "loan_details", "spare_part_requests"):
            self.assertEqual(list(getattr(i, attr)), [], attr)


class TestLoan(ModelTestCase):
    def loan(self, **kw):
        u = self.user()
        l = Loan(user_id=u.id, due_date=datetime.utcnow() + timedelta(days=3), **kw)
        db.session.add(l); db.session.commit()
        return l

    def test_defaults(self):
        l = self.loan()
        self.assertEqual(l.status, "ACTIVE")
        self.assertEqual(l.fine_amount, 0.0)
        self.assertFalse(l.sanction_active)
        self.assertIsNotNone(l.loan_date)
        self.assertIsNone(l.return_date)

    def test_due_date_required(self):
        u = self.user()
        db.session.add(Loan(user_id=u.id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_user_required_and_fk(self):
        db.session.add(Loan(user_id="nope", due_date=datetime.utcnow()))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_details_and_item_link(self):
        l, i = self.loan(), self.item()
        d = LoanDetail(loan_id=l.id, item_id=i.id, delivery_status="BUENO")
        db.session.add(d); db.session.commit()
        self.assertEqual(l.details[0].item.id, i.id)
        self.assertEqual(d.loan.id, l.id)
        self.assertEqual(i.loan_details[0].loan_id, l.id)

    def test_sanction_fields_roundtrip(self):
        admin = self.user("ADMIN")
        l = self.loan(sanction_type="DAYS", sanction_days=7, sanction_active=True,
                      sanction_description="no devolvió", sanction_created_at=datetime.utcnow(),
                      sanction_lifted_by=admin.id)
        self.assertEqual(Loan.query.get(l.id).sanction_days, 7)

    def test_detail_requires_loan_and_item(self):
        db.session.add(LoanDetail(item_id=self.item().id))
        with self.assertRaises(IntegrityError):
            db.session.commit()


class TestReservation(ModelTestCase):
    def res(self, **kw):
        return Reservation(user_id=self.user().id, item_id=self.item().id, **kw)

    def test_defaults(self):
        r = self.res(); db.session.add(r); db.session.commit()
        self.assertEqual(r.status, "QUEUED")
        self.assertTrue(r.token and len(r.token) >= 32)
        self.assertFalse(r.is_deleted)
        self.assertFalse(r.eight_minute_reminder_sent)
        self.assertIsNotNone(r.reservation_date)

    def test_tokens_are_unique_per_reservation(self):
        a, b = self.res(), self.res()
        db.session.add_all([a, b]); db.session.commit()
        self.assertNotEqual(a.token, b.token)

    def test_duplicate_token_rejected(self):
        a = self.res(token="T"); db.session.add(a); db.session.commit()
        db.session.add(self.res(token="T"))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_item_backref_and_converted_loan(self):
        r = self.res(); db.session.add(r); db.session.commit()
        self.assertIn(r, r.item.reservations)
        l = Loan(user_id=r.user_id, due_date=datetime.utcnow())
        db.session.add(l); db.session.commit()
        r.converted_loan_id = l.id; db.session.commit()
        self.assertEqual(Reservation.query.get(r.id).converted_loan_id, l.id)


class TestMaintenanceAndOutputs(ModelTestCase):
    def maint(self, **kw):
        m = Maintenance(item_id=self.item().id, reported_by=self.user().id,
                        failure_description="falla", **kw)
        db.session.add(m); db.session.commit()
        return m

    def test_defaults(self):
        m = self.maint()
        self.assertEqual((m.severity, m.maintenance_type, m.status),
                         ("LOW", "CORRECTIVE", "PENDING"))
        self.assertEqual(m.cost, 0.0)
        self.assertFalse(m.requires_replacement)
        self.assertFalse(m.is_deleted)

    def test_resolution_time(self):
        m = self.maint()
        self.assertIsNone(m.resolution_time)
        m.start_date = datetime(2026, 1, 1); m.end_date = datetime(2026, 1, 3)
        self.assertEqual(m.resolution_time, timedelta(days=2))

    def test_failure_description_required(self):
        db.session.add(Maintenance(item_id=self.item().id, reported_by=self.user().id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_item_output_defaults_and_to_dict(self):
        i, u = self.item(), self.user("ADMIN")
        o = ItemOutput(item_id=i.id, user_id=u.id, type=OutputType.MAINTENANCE)
        db.session.add(o); db.session.commit()
        self.assertEqual(o.status, OutputStatus.ACTIVE)
        d = o.to_dict()
        self.assertEqual(d["item_code"], i.code)
        self.assertEqual(d["user_name"], u.name)
        self.assertIsNotNone(d["created_at"])
        self.assertIsNone(d["actual_return_date"])
        json.dumps(d)

    def test_item_output_type_required(self):
        db.session.add(ItemOutput(item_id=self.item().id, user_id=self.user().id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_spare_part_request(self):
        s = SparePartRequest(item_id=self.item().id, requested_by=self.user().id,
                             reason="r", cost=10.5, supplier="P", invoice_image="data:x")
        db.session.add(s); db.session.commit()
        self.assertEqual(s.status, "PENDING")
        self.assertIn(s, s.item.spare_part_requests)
        self.assertIn(s, s.requester.spare_part_requests)
        self.assertIn("SparePartRequest", repr(s))

    def test_spare_part_requires_invoice(self):
        db.session.add(SparePartRequest(item_id=self.item().id, requested_by=self.user().id,
                                        reason="r", cost=1, supplier="P"))
        with self.assertRaises(IntegrityError):
            db.session.commit()


class TestTicketsAndChat(ModelTestCase):
    def ticket(self, **kw):
        t = Ticket(user_id=self.user().id, subject="s", description="d", **kw)
        db.session.add(t); db.session.commit()
        return t

    def test_defaults(self):
        t = self.ticket()
        self.assertEqual((t.severity, t.status), ("MEDIUM", "OPEN"))
        self.assertFalse(t.is_deleted)
        self.assertIsNone(t.satisfaction)
        self.assertIsNone(t.source_thread_id)

    def test_required(self):
        db.session.add(Ticket(user_id=self.user().id, subject="s"))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_ticket_message_flow_and_cascade(self):
        t = self.ticket()
        m = TicketMessage(ticket_id=t.id, sender_id=t.user_id, body="hola")
        db.session.add(m); db.session.commit()
        self.assertFalse(m.is_read)
        self.assertEqual(m.sender.id, t.user_id)
        self.assertEqual(t.messages.count(), 1)
        db.session.delete(t); db.session.commit()
        self.assertEqual(TicketMessage.query.count(), 0)

    def test_ticket_message_media(self):
        t = self.ticket()
        m = TicketMessage(ticket_id=t.id, sender_id=t.user_id, body="",
                          media_url="data:image/png;base64,AA", media_type="image")
        db.session.add(m); db.session.commit()
        self.assertEqual(TicketMessage.query.first().media_type, "image")

    def test_ticket_message_body_required(self):
        t = self.ticket()
        db.session.add(TicketMessage(ticket_id=t.id, sender_id=t.user_id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_staff_message(self):
        a, b = self.user("BIBLIOTECARIO"), self.user("ALMACENISTA")
        m = StaffMessage(sender_id=a.id, receiver_id=b.id, body="hey")
        db.session.add(m); db.session.commit()
        self.assertEqual(m.sender.id, a.id)
        self.assertEqual(m.receiver.id, b.id)
        self.assertFalse(m.is_read)


class TestNotificationsAndAudit(ModelTestCase):
    def test_notification_defaults(self):
        u = self.user()
        n = Notification(user_id=u.id, message="m", type="GENERIC")
        db.session.add(n); db.session.commit()
        self.assertFalse(n.is_read)
        self.assertIsNotNone(n.date)

    def test_notification_message_required(self):
        db.session.add(Notification(user_id=self.user().id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_notification_user_fk(self):
        db.session.add(Notification(user_id="ghost", message="m"))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_movement(self):
        m = Movement(item_id=self.item().id, user_id=self.user().id, movement_type="LOAN")
        db.session.add(m); db.session.commit()
        self.assertIn(m, m.item.movements)

    def test_audit_log_allows_null_user_and_links_backref(self):
        db.session.add(AuditLog(action="LOGIN_FAILED")); db.session.commit()
        u = self.user()
        a = AuditLog(user_id=u.id, action="LOGIN_SUCCESS"); db.session.add(a); db.session.commit()
        self.assertIn(a, u.audit_logs)
        self.assertIsNotNone(a.created_at)

    def test_audit_log_action_required(self):
        db.session.add(AuditLog())
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_audit_log_timestamp_is_utc_like_other_models(self):
        # AuditLog usa datetime.now (hora local); el resto de modelos, utcnow.
        a = AuditLog(action="X"); db.session.add(a); db.session.commit()
        delta = abs((a.created_at - datetime.utcnow()).total_seconds())
        self.assertLess(delta, 60, "AuditLog.created_at no está en UTC como el resto")


class TestAuthTokens(ModelTestCase):
    def test_refresh_token(self):
        u = self.user()
        t = RefreshToken(user_id=u.id, token_hash="h", expires_at=datetime.utcnow())
        db.session.add(t); db.session.commit()
        self.assertFalse(t.is_revoked)
        self.assertIn(t, u.refresh_tokens)

    def test_refresh_token_hash_unique(self):
        u = self.user()
        for _ in range(2):
            db.session.add(RefreshToken(user_id=u.id, token_hash="h", expires_at=datetime.utcnow()))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_password_reset_token(self):
        t = PasswordResetToken(user_id=self.user().id, token_hash="h", expires_at=datetime.utcnow())
        db.session.add(t); db.session.commit()
        self.assertFalse(t.is_used)

    def test_verification_code(self):
        v = VerificationCode(user_id=self.user().id, purpose="ACCOUNT_VERIFY",
                             code_hash="h", expires_at=datetime.utcnow())
        db.session.add(v); db.session.commit()
        self.assertEqual((v.is_used, v.attempts), (False, 0))

    def test_pending_registration(self):
        p = PendingRegistration(email="a@t.com", document_number="1", payload="{}",
                                code_hash="h", expires_at=datetime.utcnow())
        db.session.add(p); db.session.commit()
        self.assertEqual(p.attempts, 0)
        db.session.add(PendingRegistration(email="a@t.com", document_number="2", payload="{}",
                                           code_hash="h", expires_at=datetime.utcnow()))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_trusted_device_unique_per_user(self):
        u = self.user()
        db.session.add(TrustedDevice(user_id=u.id, device_id="d")); db.session.commit()
        db.session.add(TrustedDevice(user_id=u.id, device_id="d"))
        with self.assertRaises(IntegrityError):
            db.session.commit()
        db.session.rollback()
        other = self.user()
        db.session.add(TrustedDevice(user_id=other.id, device_id="d")); db.session.commit()

    def test_email_change_token(self):
        t = EmailChangeToken(user_id=self.user().id, new_email="n@t.com",
                             token_hash="h", expires_at=datetime.utcnow())
        db.session.add(t); db.session.commit()
        self.assertFalse(t.is_used)


class TestPreferencesSavedThreads(ModelTestCase):
    def test_preference_defaults(self):
        p = UserPreference(user_id=self.user().id); db.session.add(p); db.session.commit()
        self.assertTrue(p.notif_loan_reminder)
        self.assertFalse(p.notif_promotions)
        self.assertEqual((p.alert_reminder_days, p.quiet_start, p.quiet_end), (2, "22:00", "07:00"))
        self.assertTrue(p.channel_email and p.channel_inapp)
        self.assertFalse(p.channel_sms)

    def test_preference_one_per_user(self):
        u = self.user()
        db.session.add(UserPreference(user_id=u.id)); db.session.commit()
        db.session.add(UserPreference(user_id=u.id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_saved_item_unique(self):
        u, i = self.user(), self.item()
        db.session.add(SavedItem(user_id=u.id, item_id=i.id)); db.session.commit()
        db.session.add(SavedItem(user_id=u.id, item_id=i.id))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_saved_item_fks(self):
        db.session.add(SavedItem(user_id="ghost", item_id=1))
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_assistant_thread_defaults(self):
        t = AssistantThread(id="thread_1", user_id=self.user().id)
        db.session.add(t); db.session.commit()
        self.assertEqual(t.title, "Nueva conversación")
        self.assertEqual(json.loads(t.messages), [])

    def test_assistant_thread_stores_json(self):
        msgs = [{"id": "1", "text": "hola ñandú 😀"}]
        t = AssistantThread(id="thread_2", user_id=self.user().id, messages=json.dumps(msgs))
        db.session.add(t); db.session.commit()
        self.assertEqual(json.loads(AssistantThread.query.get("thread_2").messages), msgs)

    def test_assistant_thread_user_fk(self):
        db.session.add(AssistantThread(id="t", user_id="ghost"))
        with self.assertRaises(IntegrityError):
            db.session.commit()


class TestAIModels(ModelTestCase):
    def test_learned_response_defaults(self):
        r = AILearnedResponse(query_text="q", query_keywords="k", response_text="r")
        db.session.add(r); db.session.commit()
        self.assertEqual((r.use_count, r.positive_feedback, r.negative_feedback), (0, 0, 0))
        self.assertEqual(r.source, "gemini")
        self.assertIsNone(r.role)
        self.assertIn("AILearnedResponse", repr(r))

    def test_learned_response_required(self):
        db.session.add(AILearnedResponse(query_text="q"));
        with self.assertRaises(IntegrityError):
            db.session.commit()

    def test_feedback_and_unanswered(self):
        f = AIResponseFeedback(useful=True, query_text="q"); u = AIUnansweredQuery(query_text="q")
        db.session.add_all([f, u]); db.session.commit()
        self.assertFalse(u.resolved)
        self.assertIn("👍", repr(f))
        db.session.add(AIResponseFeedback(query_text="x"))
        with self.assertRaises(IntegrityError):
            db.session.commit()


if __name__ == "__main__":
    unittest.main(verbosity=2)
