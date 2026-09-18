"""Segunda tanda de pruebas: salidas, mantenimiento, repuestos, reportes, historial,
auditoría, tareas programadas, perfil/preferencias y sesiones.

Ejecutar desde la raíz:  python -m unittest tests.test_routes_extra -v
"""
import os
import unittest
from datetime import datetime, timedelta

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from app.extensions import db
from app.models import (
    User, Item, Status, Loan, LoanDetail, Reservation, Notification, Ticket,
    AuditLog, Maintenance, ItemOutput, SparePartRequest, RefreshToken,
    TrustedDevice, UserPreference,
)
from tests.test_routes import RouteCase, PW


def status_name(item_id):
    return Item.query.get(item_id).status_obj.name


class TestOutputFlow(RouteCase):
    def setUp(self):
        super().setUp()
        self.staff = self.make("ADMIN")
        self.h = self.H(self.staff)
        self.item = self.stocked_item(self.dep_bib)

    def out(self, tipo="MAINTENANCE", item=None, **kw):
        return self.c.post("/api/v1/outputs/", headers=self.h, json={
            "item_id": (item or self.item).id, "tipo_salida": tipo, "destino": "Taller", **kw})

    def test_required_fields_and_unknown_item(self):
        self.assertEqual(self.c.post("/api/v1/outputs/", headers=self.h, json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/outputs/", headers=self.h, json={"item_id": 999, "tipo_salida": "TRANSFER"}).status_code, 404)

    def test_status_follows_output_type(self):
        for tipo, expected in [("MAINTENANCE", "IN_MAINTENANCE"), ("TRANSFER", "UNAVAILABLE"),
                               ("INTERNAL_USE", "UNAVAILABLE"), ("DISPOSAL", "DECOMMISSIONED")]:
            it = self.stocked_item(self.dep_bib)
            r = self.out(tipo, it)
            self.assertEqual(r.status_code, 201, (tipo, r.get_json()))
            self.assertEqual(status_name(it.id), expected, tipo)

    def test_item_must_be_available(self):
        self.assertEqual(self.out().status_code, 201)
        self.assertEqual(self.out().status_code, 400, "no se puede sacar dos veces el mismo elemento")
        self.assertEqual(ItemOutput.query.count(), 1)

    def test_deleted_item_rejected(self):
        self.item.is_deleted = True; db.session.commit()
        self.assertEqual(self.out().status_code, 400)

    def test_invalid_return_date_is_a_client_error(self):
        r = self.out(fecha_retorno_estimada="no-es-fecha")
        self.assertEqual(r.status_code, 400, "fecha inválida debería ser 400, no 500")
        self.assertEqual(status_name(self.item.id), "AVAILABLE")

    def test_return_restores_item(self):
        oid = self.out().get_json()["data"]["id"]
        r = self.c.patch(f"/api/v1/outputs/{oid}/return", headers=self.h, json={"condicion": "BUENA"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(status_name(self.item.id), "AVAILABLE")
        self.assertEqual(ItemOutput.query.get(oid).status, "RETURNED")
        self.assertIsNotNone(ItemOutput.query.get(oid).actual_return_date)
        self.assertEqual(self.c.patch(f"/api/v1/outputs/{oid}/return", headers=self.h, json={}).status_code, 400)

    def test_return_without_body_does_not_crash(self):
        oid = self.out().get_json()["data"]["id"]
        r = self.c.patch(f"/api/v1/outputs/{oid}/return", headers=self.h)
        self.assertLess(r.status_code, 500, "PATCH sin cuerpo no debería ser un 500")

    def test_disposal_cannot_be_returned_but_can_be_closed_once(self):
        oid = self.out("DISPOSAL").get_json()["data"]["id"]
        self.assertEqual(self.c.patch(f"/api/v1/outputs/{oid}/return", headers=self.h, json={}).status_code, 400)
        self.assertEqual(self.c.patch(f"/api/v1/outputs/{oid}/close", headers=self.h).status_code, 200)
        self.assertEqual(status_name(self.item.id), "DECOMMISSIONED")
        self.assertEqual(self.c.patch(f"/api/v1/outputs/{oid}/close", headers=self.h).status_code, 400)

    def test_unknown_output_404(self):
        self.assertEqual(self.c.patch("/api/v1/outputs/999/close", headers=self.h).status_code, 404)

    def test_list_filters_and_serialization(self):
        self.out()
        rows = self.c.get("/api/v1/outputs/", headers=self.h).get_json()
        self.assertEqual(len(rows), 1)
        for key in ("item_name", "item_code", "user_name", "type", "status", "created_at"):
            self.assertIn(key, rows[0])
        self.assertEqual(rows[0]["user_id"], self.staff.id)

    def test_audit_trail(self):
        self.out()
        self.assertEqual(AuditLog.query.filter_by(action="SALIDA_CREATED").count(), 1)


class TestMaintenanceFlow(RouteCase):
    def setUp(self):
        super().setUp()
        self.sup = self.make("SOPORTE"); self.h = self.H(self.sup)
        self.item = self.stocked_item(self.dep_bib)

    def create(self, **kw):
        return self.c.post("/api/v1/maintenance/", headers=self.h,
                           json={"item_id": self.item.id, "description": "no enciende", **kw})

    def test_create_blocks_item_and_notifies_support(self):
        r = self.create(severity="HIGH", type="PREVENTIVE")
        self.assertEqual(r.status_code, 201)
        m = Maintenance.query.get(r.get_json()["id"])
        self.assertEqual((m.severity, m.maintenance_type, m.status, m.reported_by), ("HIGH", "PREVENTIVE", "PENDING", self.sup.id))
        self.assertEqual(status_name(self.item.id), "IN_MAINTENANCE")
        self.assertTrue(Notification.query.filter_by(user_id=self.sup.id, type="MAINTENANCE_CREATED").count())

    def test_status_transitions_manage_item_status(self):
        mid = self.create().get_json()["id"]
        url = f"/api/v1/maintenance/{mid}/status"
        self.assertEqual(self.c.put(url, headers=self.h, json={"status": "NOPE"}).status_code, 400)
        self.assertEqual(self.c.put(url, headers=self.h, json={"status": "IN_PROGRESS"}).status_code, 200)
        self.assertEqual(status_name(self.item.id), "IN_MAINTENANCE")
        self.assertEqual(Maintenance.query.get(mid).status, "IN_PROGRESS")
        self.assertEqual(self.c.put(url, headers=self.h, json={"status": "COMPLETED"}).status_code, 200)
        self.assertEqual(status_name(self.item.id), "AVAILABLE")
        self.assertIsNotNone(Maintenance.query.get(mid).end_date)

    def test_cancel_releases_item(self):
        mid = self.create().get_json()["id"]
        self.c.put(f"/api/v1/maintenance/{mid}/status", headers=self.h, json={"status": "CANCELLED"})
        self.assertEqual(status_name(self.item.id), "AVAILABLE")

    def test_status_update_without_body_is_a_client_error(self):
        mid = self.create().get_json()["id"]
        r = self.c.put(f"/api/v1/maintenance/{mid}/status", headers=self.h)
        self.assertLess(r.status_code, 500)

    def test_complete_saves_report_and_frees_item(self):
        mid = self.create().get_json()["id"]
        r = self.c.post(f"/api/v1/maintenance/{mid}/complete", headers=self.h, json={
            "solution": "cambio de fuente", "diagnosis": "fuente dañada", "cost": 45000,
            "evidence_photo": "data:image/png;base64,AAAA"})
        self.assertEqual(r.status_code, 200)
        m = Maintenance.query.get(mid)
        self.assertEqual((m.status, m.solution, m.cost), ("COMPLETED", "cambio de fuente", 45000))
        self.assertEqual(m.evidence_photo, "data:image/png;base64,AAAA")
        self.assertEqual(status_name(self.item.id), "AVAILABLE")

    def test_complete_rejects_non_image_evidence(self):
        mid = self.create().get_json()["id"]
        self.c.post(f"/api/v1/maintenance/{mid}/complete", headers=self.h, json={"evidence_photo": "javascript:alert(1)"})
        self.assertIsNone(Maintenance.query.get(mid).evidence_photo)

    def test_complete_with_bad_cost_is_a_client_error(self):
        mid = self.create().get_json()["id"]
        r = self.c.post(f"/api/v1/maintenance/{mid}/complete", headers=self.h, json={"cost": "mucho"})
        self.assertLess(r.status_code, 500, "un costo no numérico no debería producir un 500")

    def test_list_includes_created_case(self):
        self.create(severity="CRITICAL")
        rows = self.c.get("/api/v1/maintenance/?severity=CRITICAL", headers=self.h).get_json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(self.c.get("/api/v1/maintenance/?severity=LOW", headers=self.h).get_json(), [])

    def test_unknown_id_404(self):
        self.assertEqual(self.c.put("/api/v1/maintenance/999/status", headers=self.h, json={"status": "PENDING"}).status_code, 404)
        self.assertEqual(self.c.post("/api/v1/maintenance/999/complete", headers=self.h, json={}).status_code, 404)


class TestSpareParts(RouteCase):
    def setUp(self):
        super().setUp()
        self.sup = self.make("SOPORTE"); self.h = self.H(self.sup)
        self.item = self.stocked_item(self.dep_bib)

    def body(self, **kw):
        return {"item_id": self.item.id, "reason": "falla", "cost": 1200.5, "supplier": "Prov",
                "invoice_image": "data:image/png;base64,AA", **kw}

    def test_only_support_and_admin(self):
        for role in ("APRENDIZ", "BIBLIOTECARIO", "ALMACENISTA"):
            self.assertEqual(self.c.get("/api/v1/spare_parts/", headers=self.H(self.make(role))).status_code, 403, role)
        for role in ("SOPORTE", "ADMIN"):
            self.assertEqual(self.c.get("/api/v1/spare_parts/", headers=self.H(self.make(role))).status_code, 200, role)

    def test_create_and_list(self):
        r = self.c.post("/api/v1/spare_parts/", headers=self.h, json=self.body())
        self.assertEqual(r.status_code, 201)
        rows = self.c.get("/api/v1/spare_parts/", headers=self.h).get_json()
        self.assertEqual((rows[0]["status"], rows[0]["cost"], rows[0]["item_code"]), ("PENDING", 1200.5, self.item.code))

    def test_missing_fields_and_unknown_item(self):
        b = self.body(); b.pop("supplier")
        self.assertEqual(self.c.post("/api/v1/spare_parts/", headers=self.h, json=b).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/spare_parts/", headers=self.h, json=self.body(item_id=999)).status_code, 404)

    def test_non_numeric_cost_is_a_client_error(self):
        r = self.c.post("/api/v1/spare_parts/", headers=self.h, json=self.body(cost="abc"))
        self.assertEqual(r.status_code, 400, "un costo no numérico debería ser 400, no 500")
        self.assertEqual(SparePartRequest.query.count(), 0)

    def test_negative_cost_rejected(self):
        r = self.c.post("/api/v1/spare_parts/", headers=self.h, json=self.body(cost=-5))
        self.assertEqual(r.status_code, 400, "un costo negativo no tiene sentido")

    def test_receive_requires_evidence_and_only_once(self):
        sid = self.c.post("/api/v1/spare_parts/", headers=self.h, json=self.body()).get_json()["id"]
        url = f"/api/v1/spare_parts/{sid}/receive"
        self.assertEqual(self.c.put(url, headers=self.h, json={}).status_code, 400)
        self.assertEqual(self.c.put(url, headers=self.h, json={"received_image": "data:image/png;base64,BB"}).status_code, 200)
        req = SparePartRequest.query.get(sid)
        self.assertEqual(req.status, "RECEIVED"); self.assertIsNotNone(req.received_at)
        self.assertEqual(self.c.put(url, headers=self.h, json={"received_image": "x"}).status_code, 400)
        self.assertEqual(self.c.put("/api/v1/spare_parts/999/receive", headers=self.h, json={"received_image": "x"}).status_code, 404)


class TestReports(RouteCase):
    def setUp(self):
        super().setUp()
        self.ap = self.make(); self.sup = self.make("SOPORTE"); self.sup2 = self.make("SOPORTE")
        self.admin = self.make("ADMIN")

    def report(self, user=None, **kw):
        return self.c.post("/api/v1/reports_mgmt/", headers=self.H(user or self.ap),
                           json={"subject": "Se rompió", "description": "detalle", **kw})

    def test_create_validates_and_normalizes(self):
        self.assertEqual(self.report(subject="").status_code, 400)
        self.assertEqual(self.report(description="  ").status_code, 400)
        r = self.report(severity="banana")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Ticket.query.get(r.get_json()["id"]).severity, "MEDIUM")
        r = self.report(severity="critical")
        self.assertEqual(Ticket.query.get(r.get_json()["id"]).severity, "CRITICAL")

    def test_create_notifies_support_and_saves_photo(self):
        r = self.report(photo="data:image/png;base64,AA")
        t = Ticket.query.get(r.get_json()["id"])
        self.assertEqual((t.status, t.user_id, t.photo), ("OPEN", self.ap.id, "data:image/png;base64,AA"))
        self.assertTrue(Notification.query.filter_by(type="TICKET_CREATED", related_id=t.id).count())

    def test_non_image_photo_ignored(self):
        t = Ticket.query.get(self.report(photo="http://evil/x.js").get_json()["id"])
        self.assertIsNone(t.photo)

    def test_apprentice_cannot_read_or_take(self):
        tid = self.report().get_json()["id"]
        h = self.H(self.ap)
        for url in ("/api/v1/reports_mgmt/", "/api/v1/reports_mgmt/unassigned", "/api/v1/reports_mgmt/all_incidents", "/api/v1/reports_mgmt/stats"):
            self.assertEqual(self.c.get(url, headers=h).status_code, 403, url)
        self.assertEqual(self.c.put(f"/api/v1/reports_mgmt/{tid}/take", headers=h).status_code, 403)

    def test_take_case_flow(self):
        tid = self.report().get_json()["id"]
        un = self.c.get("/api/v1/reports_mgmt/unassigned", headers=self.H(self.sup)).get_json()
        self.assertEqual([t["id"] for t in un], [tid])
        r = self.c.put(f"/api/v1/reports_mgmt/{tid}/take", headers=self.H(self.sup))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(Ticket.query.get(tid).assigned_to, self.sup.id)
        self.assertEqual(Ticket.query.get(tid).status, "IN_PROGRESS")
        self.assertEqual(self.c.put(f"/api/v1/reports_mgmt/{tid}/take", headers=self.H(self.sup2)).status_code, 400)
        self.assertEqual(self.c.get("/api/v1/reports_mgmt/unassigned", headers=self.H(self.sup)).get_json(), [])
        self.assertEqual(self.c.put("/api/v1/reports_mgmt/999/take", headers=self.H(self.sup)).status_code, 404)

    def test_support_only_sees_own_cases_admin_sees_all(self):
        t1 = self.report().get_json()["id"]; t2 = self.report().get_json()["id"]
        self.c.put(f"/api/v1/reports_mgmt/{t1}/take", headers=self.H(self.sup))
        self.c.put(f"/api/v1/reports_mgmt/{t2}/take", headers=self.H(self.sup2))
        mine = [t["id"] for t in self.c.get("/api/v1/reports_mgmt/", headers=self.H(self.sup)).get_json()]
        self.assertEqual(mine, [t1])
        self.assertEqual(len(self.c.get("/api/v1/reports_mgmt/", headers=self.H(self.admin)).get_json()), 2)
        self.assertEqual(len(self.c.get("/api/v1/reports_mgmt/all_incidents", headers=self.H(self.sup)).get_json()), 2)

    def test_stats_scoped_by_role(self):
        t1 = self.report(severity="CRITICAL").get_json()["id"]; self.report()
        self.c.put(f"/api/v1/reports_mgmt/{t1}/take", headers=self.H(self.sup))
        s_sup = self.c.get("/api/v1/reports_mgmt/stats", headers=self.H(self.sup)).get_json()
        s_adm = self.c.get("/api/v1/reports_mgmt/stats", headers=self.H(self.admin)).get_json()
        self.assertEqual((s_sup["total"], s_sup["critical"]), (1, 1))
        self.assertEqual((s_adm["total"], s_adm["open"], s_adm["critical"]), (2, 1, 1))

    def test_deleted_tickets_are_hidden(self):
        tid = self.report().get_json()["id"]
        Ticket.query.get(tid).is_deleted = True; db.session.commit()
        self.assertEqual(self.c.get("/api/v1/reports_mgmt/all_incidents", headers=self.H(self.admin)).get_json(), [])
        self.assertEqual(self.c.put(f"/api/v1/reports_mgmt/{tid}/take", headers=self.H(self.sup)).status_code, 404)


class TestHistory(RouteCase):
    def test_history_mixes_loans_and_reservations_own_only(self):
        ap, other, staff = self.make(), self.make(), self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        loaned, reserved = self.stocked_item(self.dep_bib), self.stocked_item(self.dep_bib)
        self.c.post("/api/v1/loans/", headers=self.H(staff), json={"user_id": ap.id, "item_ids": [loaned.id]})
        self.c.post("/api/v1/reservations/", headers=self.H(ap), json={"item_id": reserved.id})
        rows = self.c.get("/api/v1/history/my", headers=self.H(ap)).get_json()
        self.assertEqual(sorted(r["kind"] for r in rows), ["LOAN", "RESERVATION"])
        self.assertEqual(self.c.get("/api/v1/history/my", headers=self.H(other)).get_json(), [])

    def test_history_survives_deleted_item(self):
        ap, staff = self.make(), self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        it = self.stocked_item(self.dep_bib)
        self.c.post("/api/v1/loans/", headers=self.H(staff), json={"user_id": ap.id, "item_ids": [it.id]})
        it.is_deleted = True; db.session.commit()
        rows = self.c.get("/api/v1/history/my", headers=self.H(ap)).get_json()
        self.assertEqual(rows[0]["items"][0]["name"], it.name)


class TestAuditRoutes(RouteCase):
    def setUp(self):
        super().setUp()
        self.admin = self.make("ADMIN"); self.h = self.H(self.admin)
        db.session.add_all([
            AuditLog(user_id=self.admin.id, action="LOGIN_SUCCESS", ip="1.1.1.1"),
            AuditLog(user_id=self.admin.id, action="ITEM_CREATED", entity="items", entity_id="1", entity_name="Taladro"),
            AuditLog(user_id=self.admin.id, action="ITEM_DELETED", entity="items", entity_id="2"),
            AuditLog(action="LOGIN_FAILED_NO_USER"),
        ]); db.session.commit()

    def test_admin_only(self):
        for role in ("APRENDIZ", "SOPORTE", "BIBLIOTECARIO", "ALMACENISTA"):
            self.assertEqual(self.c.get("/api/v1/audit/", headers=self.H(self.make(role))).status_code, 403, role)
        self.assertEqual(self.c.get("/api/v1/audit/", headers=self.h).status_code, 200)

    def test_filters(self):
        get = lambda q: [r["action"] for r in self.c.get("/api/v1/audit/" + q, headers=self.h).get_json()]
        self.assertEqual(sorted(get("?action_type=LOGIN")), ["LOGIN_FAILED_NO_USER", "LOGIN_SUCCESS"])
        self.assertIn("ITEM_CREATED", get("?action_type=INSERT"))
        self.assertNotIn("ITEM_DELETED", get("?action_type=INSERT"))
        self.assertEqual(get("?action_type=DELETE"), ["ITEM_DELETED"])
        self.assertEqual(get("?search=Taladro"), ["ITEM_CREATED"])
        self.assertEqual(get("?search=1.1.1.1"), ["LOGIN_SUCCESS"])

    def test_anonymous_events_are_labelled_and_names_resolved(self):
        rows = self.c.get("/api/v1/audit/", headers=self.h).get_json()
        anon = [r for r in rows if r["action"] == "LOGIN_FAILED_NO_USER"][0]
        self.assertEqual(anon["user"], "Sistema/Anónimo")
        item = self.stocked_item(); db.session.add(AuditLog(action="ITEM_UPDATED", entity="items", entity_id=str(item.id))); db.session.commit()
        rows = self.c.get("/api/v1/audit/?search=ITEM_UPDATED", headers=self.h).get_json()
        self.assertEqual(rows[0]["entity_name"], item.name)

    def test_newest_first_and_utc_timestamps(self):
        rows = self.c.get("/api/v1/audit/", headers=self.h).get_json()
        stamps = [r["created_at"] for r in rows]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        newest = datetime.fromisoformat(stamps[0])
        self.assertLess(abs((newest - datetime.utcnow()).total_seconds()), 120)


class TestScheduledJobs(RouteCase):
    def reservation(self, item, user, status, **kw):
        r = Reservation(user_id=user.id, item_id=item.id, status=status, **kw)
        db.session.add(r); db.session.commit()
        return r

    def test_expired_ready_reservation_promotes_next(self):
        from app.services.reservation_queue import process_reservation_queue
        a, b = self.make(), self.make(); it = self.stocked_item(self.dep_bib)
        now = datetime.utcnow()
        r1 = self.reservation(it, a, "READY", ready_at=now - timedelta(minutes=20), expiration_date=now - timedelta(minutes=5), last_reminder_sent=now)
        r2 = self.reservation(it, b, "QUEUED")
        out = process_reservation_queue()
        self.assertEqual((out["expired"], out["promoted"]), (1, 1))
        self.assertEqual((Reservation.query.get(r1.id).status, Reservation.query.get(r2.id).status), ("EXPIRED", "READY"))
        self.assertTrue(Notification.query.filter_by(user_id=a.id, type="RESERVATION_EXPIRED").count())
        self.assertTrue(Notification.query.filter_by(user_id=b.id, type="RESERVATION_READY").count())

    def test_eight_minute_warning_is_sent_once(self):
        from app.services.reservation_queue import process_reservation_queue
        a = self.make(); it = self.stocked_item(self.dep_bib); now = datetime.utcnow()
        self.reservation(it, a, "READY", ready_at=now, expiration_date=now + timedelta(minutes=6), last_reminder_sent=now)
        process_reservation_queue(); process_reservation_queue()
        self.assertEqual(Notification.query.filter_by(user_id=a.id, type="RESERVATION_CLOSE_TO_EXPIRY").count(), 1)

    def test_no_warning_when_plenty_of_time_left(self):
        from app.services.reservation_queue import process_reservation_queue
        a = self.make(); it = self.stocked_item(self.dep_bib); now = datetime.utcnow()
        self.reservation(it, a, "READY", ready_at=now, expiration_date=now + timedelta(minutes=14), last_reminder_sent=now)
        process_reservation_queue()
        self.assertEqual(Notification.query.filter_by(user_id=a.id, type="RESERVATION_CLOSE_TO_EXPIRY").count(), 0)

    def test_queue_not_promoted_while_item_is_loaned(self):
        from app.services.reservation_queue import process_reservation_queue
        staff = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id); a = self.make(); b = self.make()
        it = self.stocked_item(self.dep_bib)
        self.c.post("/api/v1/loans/", headers=self.H(staff), json={"user_id": a.id, "item_ids": [it.id]})
        r = self.reservation(it, b, "QUEUED")
        self.assertEqual(process_reservation_queue()["promoted"], 0)
        self.assertEqual(Reservation.query.get(r.id).status, "QUEUED")

    def test_returning_a_loan_promotes_queue_via_route(self):
        staff = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id); a = self.make(); b = self.make()
        it = self.stocked_item(self.dep_bib)
        lid = self.c.post("/api/v1/loans/", headers=self.H(staff), json={"user_id": a.id, "item_ids": [it.id]}).get_json()["loan_id"]
        rid = self.c.post("/api/v1/reservations/", headers=self.H(b), json={"item_id": it.id}).get_json()["id"]
        self.assertEqual(Reservation.query.get(rid).status, "QUEUED")
        self.c.post(f"/api/v1/loans/{lid}/return", headers=self.H(staff), json={})
        self.assertEqual(Reservation.query.get(rid).status, "READY")

    def test_loan_job_marks_overdue_and_notifies_staff_once(self):
        from app.services.loan_notification_service import process_loan_notifications
        staff = self.make("BIBLIOTECARIO"); u = self.make()
        loan = Loan(user_id=u.id, loan_date=datetime.utcnow() - timedelta(days=10), due_date=datetime.utcnow() - timedelta(days=1))
        db.session.add(loan); db.session.commit()
        r1 = process_loan_notifications(); r2 = process_loan_notifications()
        self.assertEqual(Loan.query.get(loan.id).status, "OVERDUE")
        self.assertEqual((r1["overdue_marked"], r1["overdue_notified"]), (1, 1))
        self.assertEqual(r2["overdue_notified"], 0)
        self.assertEqual(Notification.query.filter_by(user_id=staff.id, type="LOAN_OVERDUE").count(), 1)

    def test_loan_job_80_percent_once_and_ignores_returned(self):
        from app.services.loan_notification_service import process_loan_notifications
        u = self.make(); now = datetime.utcnow()
        near = Loan(user_id=u.id, loan_date=now - timedelta(days=9), due_date=now + timedelta(days=2))
        early = Loan(user_id=u.id, loan_date=now - timedelta(days=1), due_date=now + timedelta(days=9))
        done = Loan(user_id=u.id, loan_date=now - timedelta(days=9), due_date=now + timedelta(days=2), status="RETURNED")
        db.session.add_all([near, early, done]); db.session.commit()
        process_loan_notifications(); process_loan_notifications()
        notified = [n.related_id for n in Notification.query.filter_by(type="LOAN_80_PERCENT").all()]
        self.assertEqual(notified, [near.id])


class TestProfileAndPreferences(RouteCase):
    def test_update_profile_only_touches_allowed_fields(self):
        u = self.make(); h = self.H(u); role_before = u.role_id
        r = self.c.patch("/api/v1/users_mgmt/me", headers=h, json={
            "display_name": "  Juancho ", "phone": "3001112222", "biography": "hola",
            "role_id": 999, "email": "hack@t.com", "name": "Otro", "is_active": False})
        self.assertEqual(r.status_code, 200)
        u = User.query.get(u.id)
        self.assertEqual((u.display_name, u.phone, u.biography), ("Juancho", "3001112222", "hola"))
        self.assertEqual((u.role_id, u.email), (role_before, f"r{u.id[-1]}@t.com" if False else u.email))
        self.assertNotEqual(u.email, "hack@t.com"); self.assertNotEqual(u.name, "Otro"); self.assertTrue(u.is_active)

    def test_blank_display_name_clears_it(self):
        u = self.make(display_name="X")
        self.c.patch("/api/v1/users_mgmt/me", headers=self.H(u), json={"display_name": "  "})
        self.assertIsNone(User.query.get(u.id).display_name)

    def test_preferences_defaults_and_partial_update(self):
        u = self.make(); h = self.H(u)
        prefs = self.c.get("/api/v1/users_mgmt/me/preferences", headers=h).get_json()
        self.assertTrue(prefs["notifications"]["loanReminder"]); self.assertFalse(prefs["channels"]["sms"])
        self.c.patch("/api/v1/users_mgmt/me/preferences", headers=h, json={"channels": {"sms": True}, "alerts": {"reminderDays": 5}})
        prefs = self.c.get("/api/v1/users_mgmt/me/preferences", headers=h).get_json()
        self.assertTrue(prefs["channels"]["sms"]); self.assertEqual(prefs["alerts"]["reminderDays"], 5)
        self.assertTrue(prefs["notifications"]["loanReminder"], "un cambio parcial no debe pisar lo demás")
        self.assertEqual(UserPreference.query.filter_by(user_id=u.id).count(), 1)

    def test_preferences_are_per_user(self):
        a, b = self.make(), self.make()
        self.c.patch("/api/v1/users_mgmt/me/preferences", headers=self.H(a), json={"privacy": {"analytics": False}})
        self.assertTrue(self.c.get("/api/v1/users_mgmt/me/preferences", headers=self.H(b)).get_json()["privacy"]["analytics"])

    def test_bad_reminder_days_is_a_client_error(self):
        r = self.c.patch("/api/v1/users_mgmt/me/preferences", headers=self.H(self.make()), json={"alerts": {"reminderDays": "muchos"}})
        self.assertLess(r.status_code, 500)

    def test_profile_image_size_limit(self):
        h = self.H(self.make())
        self.assertEqual(self.c.patch("/api/v1/users_mgmt/profile-image", headers=h, json={"profile_image": "data:image/png;base64," + "A" * 8_000_001}).status_code, 400)
        self.assertEqual(self.c.patch("/api/v1/users_mgmt/profile-image", headers=h, json={"profile_image": "data:image/png;base64,AAAA"}).status_code, 200)

    def test_profile_image_rejects_script_urls(self):
        u = self.make()
        self.c.patch("/api/v1/users_mgmt/profile-image", headers=self.H(u), json={"profile_image": "javascript:alert(1)"})
        self.assertFalse((User.query.get(u.id).profile_image or "").startswith("javascript:"))

    def test_delete_account_requires_password(self):
        u = self.make()
        self.assertEqual(self.c.delete("/api/v1/users_mgmt/me", headers=self.H(u), json={"password": "mala"}).status_code, 401)
        self.assertEqual(self.c.delete("/api/v1/users_mgmt/me", headers=self.H(u), json={}).status_code, 401)
        self.assertEqual(self.c.delete("/api/v1/users_mgmt/me", headers=self.H(u), json={"password": PW}).status_code, 200)
        u = User.query.get(u.id); self.assertTrue(u.is_deleted); self.assertFalse(u.is_active)

    def test_delete_account_blocked_with_active_or_overdue_loans(self):
        for status in ("ACTIVE", "OVERDUE", "NOT_RETURNED"):
            u = self.make()
            db.session.add(Loan(user_id=u.id, due_date=datetime.utcnow(), status=status)); db.session.commit()
            r = self.c.delete("/api/v1/users_mgmt/me", headers=self.H(u), json={"password": PW})
            self.assertEqual(r.status_code, 400, f"con un préstamo {status} no se debería poder borrar la cuenta")
            self.assertFalse(User.query.get(u.id).is_deleted, status)

    def test_export_data_only_contains_own_data(self):
        a, b = self.make(), self.make()
        r = self.c.get("/api/v1/users_mgmt/me/export-data", headers=self.H(a))
        self.assertEqual(r.status_code, 200)
        text = r.get_data(as_text=True)
        self.assertIn(a.email, text); self.assertNotIn(b.email, text)
        self.assertNotIn(a.password, text, "el hash de la contraseña no debe exportarse")


class TestSessionsAndImpersonation(RouteCase):
    def login(self, user, device="d1"):
        db.session.add(TrustedDevice(user_id=user.id, device_id=device)); db.session.commit()
        return self.c.post("/api/v1/auth/login", json={"documento": user.id, "password": PW, "device_id": device})

    def tokens(self, resp):
        j = resp.get_json()
        return j.get("access_token"), j.get("refresh_token")

    def test_login_then_refresh_rotates_and_old_refresh_dies(self):
        u = self.make(); acc, ref = self.tokens(self.login(u))
        self.assertTrue(acc and ref)
        r = self.c.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {ref}"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["access_token"])
        again = self.c.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {ref}"})
        self.assertEqual(again.status_code, 401, "un refresh token ya usado no debe servir otra vez")

    def test_access_token_cannot_be_used_as_refresh(self):
        u = self.make(); acc, _ = self.tokens(self.login(u))
        self.assertIn(self.c.post("/api/v1/auth/refresh", headers={"Authorization": f"Bearer {acc}"}).status_code, (401, 422))

    def test_session_check_returns_current_role(self):
        u = self.make("ALMACENISTA"); acc, _ = self.tokens(self.login(u))
        j = self.c.get("/api/v1/auth/session-check", headers={"Authorization": f"Bearer {acc}"}).get_json()
        self.assertTrue(j["ok"])

    def test_sessions_are_private_and_revocable_only_by_owner(self):
        a, b = self.make(), self.make(); self.login(a); self.login(b)
        sess_a = self.c.get("/api/v1/auth/sessions", headers=self.H(a)).get_json()
        self.assertTrue(sess_a)
        sid = RefreshToken.query.filter_by(user_id=a.id).first().id
        self.assertEqual(self.c.delete(f"/api/v1/auth/sessions/{sid}", headers=self.H(b)).status_code, 404)
        self.assertFalse(RefreshToken.query.get(sid).is_revoked)
        self.assertEqual(self.c.delete(f"/api/v1/auth/sessions/{sid}", headers=self.H(a)).status_code, 200)
        self.assertTrue(RefreshToken.query.get(sid).is_revoked)
        self.assertEqual(TrustedDevice.query.filter_by(user_id=a.id).count(), 0)
        self.assertEqual(TrustedDevice.query.filter_by(user_id=b.id).count(), 1)

    def test_revoke_all_only_affects_self(self):
        a, b = self.make(), self.make(); self.login(a); self.login(b)
        self.c.delete("/api/v1/auth/sessions/all", headers=self.H(a))
        self.assertEqual(RefreshToken.query.filter_by(user_id=a.id, is_revoked=False).count(), 0)
        self.assertEqual(RefreshToken.query.filter_by(user_id=b.id, is_revoked=False).count(), 1)

    def test_access_history_only_own_events(self):
        a, b = self.make(), self.make()
        db.session.add_all([AuditLog(user_id=a.id, action="LOGIN_SUCCESS"), AuditLog(user_id=b.id, action="LOGIN_SUCCESS"), AuditLog(user_id=a.id, action="ITEM_CREATED")])
        db.session.commit()
        rows = self.c.get("/api/v1/auth/access-history", headers=self.H(a)).get_json()
        self.assertEqual([r["action"] for r in rows], ["LOGIN_SUCCESS"])
        self.c.delete("/api/v1/auth/access-history", headers=self.H(a))
        self.assertEqual(AuditLog.query.filter_by(user_id=b.id).count(), 1)

    def test_impersonate_only_for_admins_and_valid_roles(self):
        self.role("APRENDIZ"); self.role("SOPORTE")
        for role in ("APRENDIZ", "SOPORTE", "BIBLIOTECARIO", "ALMACENISTA"):
            r = self.c.post("/api/v1/auth/impersonate", headers=self.H(self.make(role)), json={"role": "APRENDIZ"})
            self.assertEqual(r.status_code, 403, role)
        admin = self.make("ADMIN")
        self.assertEqual(self.c.post("/api/v1/auth/impersonate", headers=self.H(admin), json={"role": "ADMIN"}).status_code, 400,
                         "no debe poder 'verse como' otro ADMIN")
        self.assertEqual(self.c.post("/api/v1/auth/impersonate", headers=self.H(admin), json={"role": "inventado"}).status_code, 400)

    def test_impersonated_session_has_the_target_roles_limits(self):
        self.role("APRENDIZ")
        admin = self.make("ADMIN")
        r = self.c.post("/api/v1/auth/impersonate", headers=self.H(admin), json={"role": "APRENDIZ"})
        self.assertEqual(r.status_code, 200, r.get_json())
        acc = r.get_json().get("access_token")
        h = {"Authorization": f"Bearer {acc}"}
        self.assertEqual(self.c.get("/api/v1/users_mgmt/", headers=h).status_code, 403)
        self.assertEqual(self.c.get("/api/v1/audit/", headers=h).status_code, 403)
        shadow = User.query.filter(User.shadow_owner_id == admin.id).first()
        self.assertIsNotNone(shadow)
        self.assertEqual(self.c.post("/api/v1/auth/impersonate", headers=h, json={"role": "APRENDIZ"}).status_code, 403)

    def test_shadow_accounts_are_hidden_from_admin_user_list(self):
        self.role("APRENDIZ"); admin = self.make("ADMIN")
        self.c.post("/api/v1/auth/impersonate", headers=self.H(admin), json={"role": "APRENDIZ"})
        ids = [u["id"] for u in self.c.get("/api/v1/users_mgmt/", headers=self.H(admin)).get_json()]
        self.assertFalse([i for i in ids if str(i).startswith("SOMBRA")])

    def test_forgot_password_does_not_reveal_whether_email_exists(self):
        a = self.c.post("/api/v1/auth/forgot-password", json={"email": "noexiste@t.com"})
        b = self.c.post("/api/v1/auth/forgot-password", json={"email": self.make().email})
        self.assertEqual(a.status_code, b.status_code, "misma respuesta exista o no el correo")

    def test_reset_password_rejects_bad_token(self):
        r = self.c.post("/api/v1/auth/reset-password", json={"token": "falso", "new_password": "Nueva123!"})
        self.assertIn(r.status_code, (400, 401, 404))
        self.assertEqual(self.c.post("/api/v1/auth/reset-password", json={"token": "x"}).status_code, 400)

    def test_diagnostic_endpoint_only_works_with_env_key(self):
        os.environ["DIAG_KEY"] = "clave-de-prueba"
        try:
            self.assertEqual(self.c.get("/api/v1/auth/_diag?key=clave-de-prueba&action=list-pending").status_code, 200)
            self.assertEqual(self.c.get("/api/v1/auth/_diag?key=otra&action=list-pending").status_code, 404)
            self.assertEqual(self.c.get("/api/v1/auth/_diag?action=list-pending").status_code, 404)
        finally:
            del os.environ["DIAG_KEY"]
        self.assertEqual(self.c.get("/api/v1/auth/_diag?key=&action=list-pending").status_code, 404, "sin DIAG_KEY no debe existir")

    def test_diagnostic_endpoint_is_not_publicly_usable(self):
        """/auth/_diag es 'TEMPORAL' y su clave está escrita en el código fuente."""
        r = self.c.get("/api/v1/auth/_diag?key=sena-diag-2026&action=list-pending")
        self.assertIn(r.status_code, (401, 403, 404), "el endpoint de diagnóstico responde con la clave publicada en el repo")

    def test_password_change_requires_current_password(self):
        u = self.make(); h = self.H(u)
        self.assertEqual(self.c.post("/api/v1/auth/request-password-change", headers=h, json={"new_password": "Nueva123!"}).status_code, 400)
        r = self.c.post("/api/v1/auth/request-password-change", headers=h, json={"old_password": "incorrecta", "new_password": "Nueva123!"})
        self.assertIn(r.status_code, (400, 401, 403))
        self.assertEqual(self.c.post("/api/v1/auth/confirm-password-change", headers=h, json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/force-change-password", headers=h, json={}).status_code, 400)

    def test_force_change_only_when_flagged(self):
        u = self.make(); h = self.H(u)
        r = self.c.post("/api/v1/auth/force-change-password", headers=h, json={"new_password": "Nueva123!"})
        self.assertIn(r.status_code, (400, 403), "sin must_change_password no debe cambiar la clave sin verificar")


class TestInputRobustness(RouteCase):
    def test_bad_query_params_do_not_500(self):
        h = self.H(self.make())
        for url in ("/api/v1/notifications/?limit=abc", "/api/v1/notifications/?offset=xyz", "/api/v1/notifications/?limit=-5"):
            self.assertLess(self.c.get(url, headers=h).status_code, 500, url)

    def test_malformed_json_bodies_do_not_500(self):
        h = {**self.H(self.make("ADMIN")), "Content-Type": "application/json"}
        for method, url in [("post", "/api/v1/loans/"), ("post", "/api/v1/reservations/"), ("post", "/api/v1/maintenance/"),
                            ("post", "/api/v1/outputs/"), ("post", "/api/v1/users_mgmt/"), ("post", "/api/v1/items/categories")]:
            r = getattr(self.c, method)(url, headers=h, data="{no es json")
            self.assertLess(r.status_code, 500, url)

    def test_sql_injection_strings_are_inert(self):
        h = self.H(self.make("ADMIN")); it = self.stocked_item(self.dep_bib)
        payload = "'; DROP TABLE items; --"
        for url in (f"/api/v1/items/?search={payload}", f"/api/v1/audit/?search={payload}", f"/api/v1/loans/?search={payload}"):
            self.assertLess(self.c.get(url, headers=h).status_code, 500, url)
        self.assertEqual(Item.query.count(), 1)

    def test_huge_text_fields_rejected_or_handled(self):
        r = self.c.post("/api/v1/reports_mgmt/", headers=self.H(self.make()), json={"subject": "s" * 500, "description": "d"})
        self.assertLess(r.status_code, 500, "un asunto de 500 caracteres (límite 200) no debería reventar")


if __name__ == "__main__":
    unittest.main(verbosity=2)
