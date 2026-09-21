"""Pruebas de las rutas HTTP (cliente de pruebas de Flask, SQLite en memoria).

Ejecutar desde la raíz:  python -m unittest tests.test_routes -v
"""
import os
import unittest
from datetime import datetime, timedelta


import bcrypt
from flask_jwt_extended import create_access_token

from app.extensions import db
from app.models import (
    User, Dependency, Item, Category, Location, Status, Loan, LoanDetail,
    Reservation, Notification, Ticket, TicketMessage, TrustedDevice, AuditLog,
)
from tests.test_models import ModelTestCase

PW = "Secreta123!"


def hashed(pw=PW):
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=4)).decode()


class RouteCase(ModelTestCase):
    def setUp(self):
        super().setUp()
        self.c = self.app.test_client()
        self.dep_bib = Dependency(name="Biblioteca")
        self.dep_alm = Dependency(name="Almacen")
        db.session.add_all([self.dep_bib, self.dep_alm]); db.session.commit()

    def make(self, role="APRENDIZ", **kw):
        kw.setdefault("is_verified", True)
        kw.setdefault("password", hashed())
        n = self.uid()
        u = User(id=kw.pop("id", str(5000 + n)), document_type="CC", name=f"U{n}",
                 email=kw.pop("email", f"r{n}@t.com"),
                 role_id=self.role(role).id, **kw)
        db.session.add(u); db.session.commit()
        return u

    def H(self, user):
        return {"Authorization": "Bearer " + create_access_token(identity=str(user.id))}

    def stocked_item(self, dep=None, stock=1, **kw):
        cat = Category(name=f"c{self.uid()}", dependency_id=dep.id if dep else None)
        loc = Location(name=f"l{self.uid()}", dependency_id=dep.id if dep else None)
        st = Status.query.filter_by(name="AVAILABLE").first() or Status(name="AVAILABLE")
        db.session.add_all([cat, loc, st]); db.session.commit()
        n = self.uid()
        i = Item(name=f"Item{n}", code=f"K{n}", category_id=cat.id, location_id=loc.id,
                 status_id=st.id, stock=stock, **kw)
        db.session.add(i); db.session.commit()
        return i


class TestAuthRoutes(RouteCase):
    def login(self, doc, pw=PW, device="dev1"):
        return self.c.post("/api/v1/auth/login", json={"documento": doc, "password": pw, "device_id": device})

    def trusted(self, u, device="dev1"):
        db.session.add(TrustedDevice(user_id=u.id, device_id=device)); db.session.commit()

    def test_login_requires_body_and_fields(self):
        self.assertEqual(self.c.post("/api/v1/auth/login", json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/login", json={"documento": "1"}).status_code, 400)

    def test_login_ok_returns_token(self):
        u = self.make(); self.trusted(u)
        r = self.login(u.id)
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertTrue(any("token" in k for k in r.get_json()))

    def test_login_unknown_document(self):
        self.assertEqual(self.login("999999999").status_code, 401)

    def test_wrong_password_counts_and_blocks_at_five(self):
        u = self.make(); self.trusted(u)
        for _ in range(5):
            self.assertEqual(self.login(u.id, "mala").status_code, 401)
        self.assertEqual(User.query.get(u.id).failed_attempts, 5)
        r = self.login(u.id, PW)
        self.assertEqual(r.status_code, 403)

    def test_success_resets_failed_attempts(self):
        u = self.make(); self.trusted(u)
        self.login(u.id, "mala")
        self.assertEqual(self.login(u.id).status_code, 200)
        self.assertEqual(User.query.get(u.id).failed_attempts, 0)

    def test_unverified_inactive_deleted_blocked_shadow(self):
        cases = {
            "unverified": (dict(is_verified=False), 403),
            "inactive": (dict(is_active=False), 403),
            "deleted": (dict(is_deleted=True), 403),
            "blocked": (dict(is_blocked=True), 403),
        }
        for name, (kw, code) in cases.items():
            u = self.make(**kw); self.trusted(u)
            self.assertEqual(self.login(u.id).status_code, code, name)
        owner = self.make("ADMIN")
        shadow = self.make(shadow_owner_id=owner.id); self.trusted(shadow)
        self.assertEqual(self.login(shadow.id).status_code, 401)

    def test_new_device_does_not_issue_token(self):
        u = self.make()
        r = self.login(u.id, device="never-seen")
        self.assertNotIn("access_token", r.get_json() or {})

    def test_login_is_by_document_not_email(self):
        u = self.make(); self.trusted(u)
        self.assertEqual(self.login(u.email).status_code, 401)

    def test_register_validates(self):
        self.assertEqual(self.c.post("/api/v1/auth/register", json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/register", json={"name": "x"}).status_code, 400)

    def test_protected_routes_reject_anonymous(self):
        for method, url in [("get", "/api/v1/loans/"), ("get", "/api/v1/loans/my"),
                            ("get", "/api/v1/users_mgmt/me"), ("post", "/api/v1/reservations/"),
                            ("get", "/api/v1/notifications/"), ("post", "/api/v1/items/"),
                            ("get", "/api/v1/audit/"), ("get", "/api/v1/chat/tickets/mine")]:
            self.assertEqual(getattr(self.c, method)(url).status_code, 401, url)

    def test_garbage_token_rejected(self):
        r = self.c.get("/api/v1/loans/my", headers={"Authorization": "Bearer basura"})
        self.assertIn(r.status_code, (401, 422))


class TestItemRoutes(RouteCase):
    def test_guest_lists_only_non_deleted(self):
        a, b = self.stocked_item(), self.stocked_item()
        b.is_deleted = True; db.session.commit()
        ids = [i["id"] for i in self.c.get("/api/v1/items/").get_json()]
        self.assertIn(a.id, ids); self.assertNotIn(b.id, ids)

    def test_search_filters(self):
        i = self.stocked_item(); i.name = "Microscopio"; db.session.commit()
        self.stocked_item()
        r = self.c.get("/api/v1/items/?search=micros").get_json()
        self.assertEqual([x["name"] for x in r], ["Microscopio"])

    def test_staff_only_sees_own_area(self):
        mine = self.stocked_item(self.dep_alm)
        theirs = self.stocked_item(self.dep_bib)
        alm = self.make("ALMACENISTA", dependency_id=self.dep_alm.id)
        ids = [i["id"] for i in self.c.get("/api/v1/items/?dependency_id=%d" % self.dep_bib.id,
                                            headers=self.H(alm)).get_json()]
        self.assertIn(mine.id, ids); self.assertNotIn(theirs.id, ids)

    def test_staff_without_area_falls_back_by_role(self):
        mine = self.stocked_item(self.dep_alm)
        alm = self.make("ALMACENISTA")
        ids = [i["id"] for i in self.c.get("/api/v1/items/", headers=self.H(alm)).get_json()]
        self.assertIn(mine.id, ids)

    def test_filters_endpoint_scoped(self):
        self.stocked_item(self.dep_alm); self.stocked_item(self.dep_bib)
        bib = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        j = self.c.get("/api/v1/items/filters", headers=self.H(bib)).get_json()
        self.assertTrue(j["locations"])
        self.assertTrue(all(l["dependency_id"] in (self.dep_bib.id, None) for l in j["locations"]))

    def test_aprendiz_cannot_create_item(self):
        ap, base = self.make(), self.stocked_item(self.dep_bib)
        r = self.c.post("/api/v1/items/", headers=self.H(ap), json={
            "name": "x", "code": "z", "dependency_id": self.dep_bib.id,
            "category_id": base.category_id, "location_id": base.location_id, "status_id": base.status_id})
        self.assertIn(r.status_code, (401, 403), r.get_json())
        self.assertEqual(Item.query.filter_by(code="z").count(), 0)

    def test_staff_cannot_delete_other_area_item(self):
        theirs = self.stocked_item(self.dep_bib)
        alm = self.make("ALMACENISTA", dependency_id=self.dep_alm.id)
        r = self.c.delete(f"/api/v1/items/{theirs.id}", headers=self.H(alm))
        self.assertIn(r.status_code, (403, 404), r.get_json())
        self.assertFalse(Item.query.get(theirs.id).is_deleted)

    def test_save_toggle(self):
        ap, i = self.make(), self.stocked_item()
        r1 = self.c.post(f"/api/v1/items/{i.id}/save", headers=self.H(ap))
        r2 = self.c.post(f"/api/v1/items/{i.id}/save", headers=self.H(ap))
        self.assertEqual((r1.status_code, r1.get_json()["saved"]), (201, True))
        self.assertEqual((r2.status_code, r2.get_json()["saved"]), (200, False))

    def test_get_item_404(self):
        self.assertEqual(self.c.get("/api/v1/items/99999").status_code, 404)


class TestLoanRoutes(RouteCase):
    def setUp(self):
        super().setUp()
        self.staff = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        self.ap = self.make()
        self.item = self.stocked_item(self.dep_bib)

    def lend(self, user=None, item=None, headers=None, **kw):
        return self.c.post("/api/v1/loans/", headers=headers or self.H(self.staff),
                           json={"user_id": (user or self.ap).id, "item_ids": [(item or self.item).id], **kw})

    def test_create_validates(self):
        h = self.H(self.staff)
        self.assertEqual(self.c.post("/api/v1/loans/", json={}, headers=h).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/loans/", json={"user_id": "nadie", "item_ids": [1]}, headers=h).status_code, 404)
        self.assertEqual(self.lend(item=type("X", (), {"id": 9999})()).status_code, 404)

    def test_create_happy_path(self):
        r = self.lend(days=5)
        self.assertEqual(r.status_code, 201, r.get_json())
        loan = Loan.query.get(r.get_json()["loan_id"])
        self.assertEqual(loan.status, "ACTIVE")
        self.assertEqual(loan.user_id, self.ap.id)
        self.assertEqual(loan.admin_id, self.staff.id)
        self.assertEqual(len(loan.details), 1)
        self.assertEqual(Item.query.get(self.item.id).status_obj.name, "LOANED")
        self.assertTrue(Notification.query.filter_by(user_id=self.ap.id, type="LOAN_CREATED").count())
        self.assertTrue(AuditLog.query.filter_by(action="LOAN_CREATED").count())

    def test_cannot_lend_same_single_unit_twice(self):
        self.assertEqual(self.lend().status_code, 201)
        other = self.make()
        self.assertEqual(self.lend(user=other).status_code, 400)
        self.assertEqual(Loan.query.count(), 1, "el préstamo fallido no debe dejar filas")

    def test_failed_loan_rolls_back(self):
        r = self.c.post("/api/v1/loans/", headers=self.H(self.staff),
                        json={"user_id": self.ap.id, "item_ids": [self.item.id, 9999]})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(Loan.query.count(), 0)
        self.assertEqual(Item.query.get(self.item.id).status_obj.name, "AVAILABLE")

    def test_aprendiz_cannot_create_loans(self):
        r = self.lend(headers=self.H(self.ap))
        self.assertEqual(r.status_code, 403, "un aprendiz no debería poder crear préstamos")

    def test_return_restores_item_and_is_on_time(self):
        lid = self.lend().get_json()["loan_id"]
        r = self.c.post(f"/api/v1/loans/{lid}/return", json={}, headers=self.H(self.staff))
        self.assertEqual(r.status_code, 200)
        loan = Loan.query.get(lid)
        self.assertEqual(loan.status, "RETURNED")
        self.assertEqual(loan.fine_amount or 0, 0)
        self.assertEqual(Item.query.get(self.item.id).status_obj.name, "AVAILABLE")

    def test_late_return_gets_fine(self):
        lid = self.lend().get_json()["loan_id"]
        loan = Loan.query.get(lid); loan.due_date = datetime.now() - timedelta(days=2); db.session.commit()
        self.c.post(f"/api/v1/loans/{lid}/return", json={}, headers=self.H(self.staff))
        self.assertEqual(Loan.query.get(lid).fine_amount, 5000.0)

    def test_return_unknown_loan_404(self):
        self.assertEqual(self.c.post("/api/v1/loans/999/return", json={}, headers=self.H(self.staff)).status_code, 404)

    def test_aprendiz_cannot_return_loans(self):
        lid = self.lend().get_json()["loan_id"]
        r = self.c.post(f"/api/v1/loans/{lid}/return", json={}, headers=self.H(self.ap))
        self.assertEqual(r.status_code, 403, "un aprendiz no debería poder marcar devoluciones")

    def test_returning_twice_is_rejected(self):
        lid = self.lend().get_json()["loan_id"]
        self.c.post(f"/api/v1/loans/{lid}/return", json={}, headers=self.H(self.staff))
        r = self.c.post(f"/api/v1/loans/{lid}/return", json={}, headers=self.H(self.staff))
        self.assertEqual(r.status_code, 400, "devolver dos veces no debería ser válido")

    def test_my_loans_only_own(self):
        self.lend()
        other = self.make()
        mine = self.c.get("/api/v1/loans/my", headers=self.H(self.ap)).get_json()
        theirs = self.c.get("/api/v1/loans/my", headers=self.H(other)).get_json()
        self.assertEqual(len(mine), 1); self.assertEqual(theirs, [])
        self.assertEqual(mine[0]["items"][0]["name"], self.item.name)

    def test_sanction_flow_blocks_reservations_until_lifted(self):
        lid = self.lend().get_json()["loan_id"]
        h = self.H(self.staff)
        self.assertEqual(self.c.post(f"/api/v1/loans/{lid}/mark-not-returned", json={"sanction_type": "X"}, headers=h).status_code, 400)
        self.assertEqual(self.c.post(f"/api/v1/loans/{lid}/mark-not-returned", json={"sanction_type": "DAYS", "sanction_days": 0}, headers=h).status_code, 400)
        self.assertEqual(self.c.post(f"/api/v1/loans/{lid}/mark-not-returned", json={"sanction_type": "CUSTOM"}, headers=h).status_code, 400)
        ok = self.c.post(f"/api/v1/loans/{lid}/mark-not-returned", json={"sanction_type": "DAYS", "sanction_days": 3}, headers=h)
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(self.c.post(f"/api/v1/loans/{lid}/mark-not-returned", json={"sanction_type": "DAYS", "sanction_days": 3}, headers=h).status_code, 400)
        free = self.stocked_item(self.dep_bib)
        blocked = self.c.post("/api/v1/reservations/", json={"item_id": free.id}, headers=self.H(self.ap))
        self.assertEqual(blocked.status_code, 400)
        self.assertEqual(self.c.post(f"/api/v1/loans/{lid}/lift-sanction", headers=h).status_code, 200)
        self.assertEqual(self.c.post(f"/api/v1/loans/{lid}/lift-sanction", headers=h).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/reservations/", json={"item_id": free.id}, headers=self.H(self.ap)).status_code, 201)

    def test_aprendiz_cannot_sanction(self):
        lid = self.lend().get_json()["loan_id"]
        r = self.c.post(f"/api/v1/loans/{lid}/mark-not-returned", json={"sanction_type": "DAYS", "sanction_days": 1}, headers=self.H(self.ap))
        self.assertEqual(r.status_code, 403)

    def test_loan_from_reservation(self):
        res = self.c.post("/api/v1/reservations/", json={"item_id": self.item.id}, headers=self.H(self.ap)).get_json()
        h = self.H(self.staff)
        self.assertEqual(self.c.post("/api/v1/loans/from_reservation", json={}, headers=h).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/loans/from_reservation", json={"token": "no"}, headers=h).status_code, 404)
        ok = self.c.post("/api/v1/loans/from_reservation", json={"token": res["token"]}, headers=h)
        self.assertEqual(ok.status_code, 201, ok.get_json())
        self.assertEqual(Reservation.query.filter_by(token=res["token"]).first().status, "CLAIMED")
        again = self.c.post("/api/v1/loans/from_reservation", json={"token": res["token"]}, headers=h)
        self.assertEqual(again.status_code, 400)

    def test_loan_consumes_users_ready_reservation(self):
        res = self.c.post("/api/v1/reservations/", json={"item_id": self.item.id}, headers=self.H(self.ap)).get_json()
        self.assertEqual(res["status"], "READY")
        self.assertEqual(self.lend().status_code, 201)
        self.assertEqual(Reservation.query.get(res["id"]).status, "CLAIMED")


class TestReservationRoutes(RouteCase):
    def setUp(self):
        super().setUp()
        self.a, self.b, self.c3 = self.make(), self.make(), self.make()
        self.item = self.stocked_item(self.dep_bib)

    def reserve(self, user, item=None):
        return self.c.post("/api/v1/reservations/", json={"item_id": (item or self.item).id}, headers=self.H(user))

    def test_requires_item_id(self):
        self.assertEqual(self.c.post("/api/v1/reservations/", json={}, headers=self.H(self.a)).status_code, 400)

    def test_unknown_item(self):
        r = self.c.post("/api/v1/reservations/", json={"item_id": 9999}, headers=self.H(self.a))
        self.assertEqual(r.status_code, 400)

    def test_first_is_ready_with_expiration(self):
        j = self.reserve(self.a).get_json()
        self.assertEqual(j["status"], "READY")
        self.assertIsNotNone(j["expiration_date"])

    def test_second_is_queued_and_third_rejected(self):
        self.reserve(self.a)
        self.assertEqual(self.reserve(self.b).get_json()["status"], "QUEUED")
        self.assertEqual(self.reserve(self.c3).status_code, 400)

    def test_duplicate_rejected(self):
        self.reserve(self.a)
        self.assertEqual(self.reserve(self.a).status_code, 400)

    def test_staff_get_notified_of_new_reservation(self):
        staff = self.make("ALMACENISTA")
        self.reserve(self.a)
        self.assertTrue(Notification.query.filter_by(user_id=staff.id, type="PENDING_APPROVAL_RESERVATION").count())

    def test_cancel_own_only(self):
        rid = self.reserve(self.a).get_json()["id"]
        self.assertEqual(self.c.post(f"/api/v1/reservations/{rid}/cancel", headers=self.H(self.b)).status_code, 404)
        self.assertEqual(self.c.post(f"/api/v1/reservations/{rid}/cancel", headers=self.H(self.a)).status_code, 200)
        self.assertEqual(self.c.post(f"/api/v1/reservations/{rid}/cancel", headers=self.H(self.a)).status_code, 400)

    def test_cancelling_ready_promotes_next_in_queue(self):
        r1 = self.reserve(self.a).get_json()["id"]
        r2 = self.reserve(self.b).get_json()["id"]
        self.c.post(f"/api/v1/reservations/{r1}/cancel", headers=self.H(self.a))
        self.assertEqual(Reservation.query.get(r2).status, "READY")
        self.assertTrue(Notification.query.filter_by(user_id=self.b.id, type="RESERVATION_READY").count())

    def test_my_reservations_isolated(self):
        self.reserve(self.a)
        mine = self.c.get("/api/v1/reservations/my", headers=self.H(self.a))
        other = self.c.get("/api/v1/reservations/my", headers=self.H(self.b))
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(len(mine.get_json()), 1)
        self.assertEqual(other.get_json(), [])

    def test_stock_two_allows_two_ready(self):
        it = self.stocked_item(self.dep_bib, stock=2)
        self.assertEqual(self.reserve(self.a, it).get_json()["status"], "READY")
        self.assertEqual(self.reserve(self.b, it).get_json()["status"], "READY")
        self.assertEqual(self.reserve(self.c3, it).get_json()["status"], "QUEUED")


class TestNotificationRoutes(RouteCase):
    def setUp(self):
        super().setUp()
        self.a, self.b = self.make(), self.make()
        for _ in range(3):
            db.session.add(Notification(user_id=self.a.id, title="t", message="m", type="GENERIC"))
        db.session.add(Notification(user_id=self.b.id, title="t", message="m", type="GENERIC"))
        db.session.commit()

    def test_list_and_count_are_per_user(self):
        self.assertEqual(len(self.c.get("/api/v1/notifications/", headers=self.H(self.a)).get_json()), 3)
        self.assertEqual(self.c.get("/api/v1/notifications/unread-count", headers=self.H(self.a)).get_json()["count"], 3)
        self.assertEqual(self.c.get("/api/v1/notifications/unread-count", headers=self.H(self.b)).get_json()["count"], 1)

    def test_mark_read_updates_count(self):
        nid = Notification.query.filter_by(user_id=self.a.id).first().id
        self.c.post(f"/api/v1/notifications/{nid}/read", headers=self.H(self.a))
        self.assertEqual(self.c.get("/api/v1/notifications/unread-count", headers=self.H(self.a)).get_json()["count"], 2)

    def test_cannot_touch_others_notifications(self):
        nid = Notification.query.filter_by(user_id=self.b.id).first().id
        self.assertEqual(self.c.post(f"/api/v1/notifications/{nid}/read", headers=self.H(self.a)).status_code, 404)
        self.assertEqual(self.c.delete(f"/api/v1/notifications/{nid}", headers=self.H(self.a)).status_code, 404)
        self.assertEqual(Notification.query.get(nid).is_read, False)

    def test_read_all_delete_and_clear(self):
        self.c.post("/api/v1/notifications/read-all", headers=self.H(self.a))
        self.assertEqual(self.c.get("/api/v1/notifications/unread-count", headers=self.H(self.a)).get_json()["count"], 0)
        self.assertEqual(self.c.get("/api/v1/notifications/?unread_only=true", headers=self.H(self.a)).get_json(), [])
        nid = Notification.query.filter_by(user_id=self.a.id).first().id
        self.assertEqual(self.c.delete(f"/api/v1/notifications/{nid}", headers=self.H(self.a)).status_code, 200)
        self.c.delete("/api/v1/notifications/clear-all", headers=self.H(self.a))
        self.assertEqual(self.c.get("/api/v1/notifications/", headers=self.H(self.a)).get_json(), [])
        self.assertEqual(self.c.get("/api/v1/notifications/unread-count", headers=self.H(self.b)).get_json()["count"], 1)

    def test_pagination(self):
        self.assertEqual(len(self.c.get("/api/v1/notifications/?limit=2", headers=self.H(self.a)).get_json()), 2)
        self.assertEqual(len(self.c.get("/api/v1/notifications/?limit=2&offset=2", headers=self.H(self.a)).get_json()), 1)


class TestUserRoutes(RouteCase):
    def test_me_returns_own_profile(self):
        u = self.make()
        j = self.c.get("/api/v1/users_mgmt/me", headers=self.H(u)).get_json()
        self.assertEqual(j["email"], u.email)
        self.assertNotIn("password", j)

    def test_aprendiz_cannot_list_users(self):
        r = self.c.get("/api/v1/users_mgmt/", headers=self.H(self.make()))
        self.assertEqual(r.status_code, 403, "un aprendiz no debería listar usuarios")

    def test_admin_can_list_users(self):
        r = self.c.get("/api/v1/users_mgmt/", headers=self.H(self.make("ADMIN")))
        self.assertEqual(r.status_code, 200)

    def test_aprendiz_cannot_create_user(self):
        self.role("ADMIN")
        r = self.c.post("/api/v1/users_mgmt/", headers=self.H(self.make()),
                        json={"id": "777", "name": "n", "email": "n@t.com", "password": "Xx123456!", "role": "ADMIN"})
        self.assertEqual(r.status_code, 403, "un aprendiz no debería crear usuarios")

    def test_aprendiz_cannot_change_roles(self):
        ap, victim = self.make(), self.make()
        self.role("ADMIN")
        r = self.c.post(f"/api/v1/users_mgmt/{victim.id}/change-role", headers=self.H(ap),
                        json={"role": "ADMIN"})
        self.assertEqual(r.status_code, 403, "escalada de privilegios: un aprendiz cambió un rol")

    def test_aprendiz_cannot_delete_or_deactivate_others(self):
        ap, victim = self.make(), self.make()
        self.assertEqual(self.c.delete(f"/api/v1/users_mgmt/{victim.id}", headers=self.H(ap)).status_code, 403)
        self.assertEqual(self.c.post(f"/api/v1/users_mgmt/{victim.id}/toggle-active", headers=self.H(ap)).status_code, 403)
        self.assertTrue(User.query.get(victim.id).is_active)

    def test_aprendiz_cannot_read_audit_log(self):
        self.assertEqual(self.c.get("/api/v1/audit/", headers=self.H(self.make())).status_code, 403)

    def test_roles_listing(self):
        self.role("ADMIN")
        r = self.c.get("/api/v1/users_mgmt/roles", headers=self.H(self.make("ADMIN")))
        self.assertEqual(r.status_code, 200)


class TestRoleMatrix(RouteCase):
    """Cada rol solo puede llamar lo que le corresponde."""

    def test_loan_list_is_staff_only(self):
        for role, code in [("APRENDIZ", 403), ("SOPORTE", 403), ("BIBLIOTECARIO", 200), ("ALMACENISTA", 200), ("ADMIN", 200)]:
            r = self.c.get("/api/v1/loans/", headers=self.H(self.make(role)))
            self.assertEqual(r.status_code, code, role)

    def test_user_admin_endpoints_are_admin_only(self):
        victim = self.make()
        self.role("APRENDIZ")
        calls = [("get", "/api/v1/users_mgmt/"), ("get", "/api/v1/users_mgmt/stats"),
                 ("get", f"/api/v1/users_mgmt/{victim.id}/detail"),
                 ("post", f"/api/v1/users_mgmt/{victim.id}/unblock")]
        for role in ("SOPORTE", "BIBLIOTECARIO", "ALMACENISTA", "APRENDIZ"):
            h = self.H(self.make(role))
            for method, url in calls:
                self.assertEqual(getattr(self.c, method)(url, headers=h).status_code, 403, (role, url))
        admin = self.H(self.make("ADMIN"))
        for method, url in calls:
            self.assertEqual(getattr(self.c, method)(url, headers=admin).status_code, 200, url)

    def test_admin_can_manage_users(self):
        admin = self.make("ADMIN"); self.role("APRENDIZ"); victim = self.make()
        h = self.H(admin)
        r = self.c.post("/api/v1/users_mgmt/", headers=h,
                        json={"id": "888", "name": "Nuevo", "email": "nuevo@t.com", "password": "Xx123456!", "role": "APRENDIZ"})
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual(self.c.post(f"/api/v1/users_mgmt/{victim.id}/toggle-active", headers=h).status_code, 200)
        self.assertFalse(User.query.get(victim.id).is_active)
        self.role("BIBLIOTECARIO")
        self.assertEqual(self.c.post(f"/api/v1/users_mgmt/{victim.id}/change-role", headers=h, json={"role": "BIBLIOTECARIO"}).status_code, 200)
        self.assertEqual(User.query.get(victim.id).role.name, "BIBLIOTECARIO")

    def test_inventory_mutations_allowed_for_staff_denied_for_others(self):
        base = self.stocked_item(self.dep_bib)
        for role in ("APRENDIZ", "SOPORTE"):
            h = self.H(self.make(role))
            self.assertEqual(self.c.post("/api/v1/items/categories", headers=h, json={"name": "zz"}).status_code, 403, role)
            self.assertEqual(self.c.post("/api/v1/items/locations", headers=h, json={"name": "zz"}).status_code, 403, role)
            self.assertEqual(self.c.put(f"/api/v1/items/{base.id}", headers=h, json={"name": "hack"}).status_code, 403, role)
            self.assertEqual(self.c.delete(f"/api/v1/items/{base.id}", headers=h).status_code, 403, role)
        self.assertEqual(Item.query.get(base.id).name, base.name)
        self.assertFalse(Item.query.get(base.id).is_deleted)
        bib = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        r = self.c.post("/api/v1/items/categories", headers=self.H(bib), json={"name": "Nueva cat"})
        self.assertEqual(r.status_code, 201, r.get_json())
        r = self.c.post("/api/v1/items/locations", headers=self.H(bib), json={"name": "Nueva loc"})
        self.assertEqual(r.status_code, 201, r.get_json())

    def test_admin_can_create_item(self):
        base = self.stocked_item(self.dep_bib)
        r = self.c.post("/api/v1/items/", headers=self.H(self.make("ADMIN")), json={
            "name": "y", "code": "zz9", "dependency_id": self.dep_bib.id,
            "category_id": base.category_id, "location_id": base.location_id, "status_id": base.status_id})
        self.assertEqual(r.status_code, 201, r.get_json())

    def test_loan_actions_denied_for_support_and_aprendiz(self):
        staff = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        item = self.stocked_item(self.dep_bib); target = self.make()
        for role in ("APRENDIZ", "SOPORTE"):
            r = self.c.post("/api/v1/loans/", headers=self.H(self.make(role)), json={"user_id": target.id, "item_ids": [item.id]})
            self.assertEqual(r.status_code, 403, role)
        self.assertEqual(Loan.query.count(), 0)
        res = self.c.post("/api/v1/reservations/", json={"item_id": item.id}, headers=self.H(target)).get_json()
        r = self.c.post("/api/v1/loans/from_reservation", headers=self.H(target), json={"token": res["token"]})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(Reservation.query.get(res["id"]).status, "READY")
        self.assertEqual(self.c.post("/api/v1/loans/from_reservation", headers=self.H(staff), json={"token": res["token"]}).status_code, 201)


    def test_maintenance_outputs_dashboard_denied_to_apprentices(self):
        item = self.stocked_item(self.dep_bib)
        h = self.H(self.make())
        checks = [
            ("get", "/api/v1/maintenance/", None), ("post", "/api/v1/maintenance/", {"item_id": item.id, "description": "x"}),
            ("put", "/api/v1/maintenance/1/status", {"status": "IN_PROGRESS"}), ("post", "/api/v1/maintenance/1/complete", {}),
            ("get", "/api/v1/outputs/", None), ("post", "/api/v1/outputs/", {"item_id": item.id, "tipo_salida": "DISPOSAL"}),
            ("patch", "/api/v1/outputs/1/return", {}), ("patch", "/api/v1/outputs/1/close", {}),
            ("get", "/api/v1/dashboard/stats", None),
        ]
        for method, url, body in checks:
            r = getattr(self.c, method)(url, headers=h, json=body) if body is not None else getattr(self.c, method)(url, headers=h)
            self.assertEqual(r.status_code, 403, url)
        from app.models import Maintenance, ItemOutput
        self.assertEqual(Maintenance.query.count(), 0)
        self.assertEqual(ItemOutput.query.count(), 0)
        self.assertEqual(Item.query.get(item.id).status_obj.name, "AVAILABLE")

    def test_maintenance_and_outputs_allowed_for_staff(self):
        item = self.stocked_item(self.dep_bib)
        for role in ("ADMIN", "SOPORTE", "BIBLIOTECARIO", "ALMACENISTA"):
            h = self.H(self.make(role))
            self.assertEqual(self.c.get("/api/v1/maintenance/", headers=h).status_code, 200, role)
            self.assertEqual(self.c.get("/api/v1/outputs/", headers=h).status_code, 200, role)
        r = self.c.post("/api/v1/maintenance/", headers=self.H(self.make("SOPORTE")), json={"item_id": item.id, "description": "no enciende"})
        self.assertEqual(r.status_code, 201, r.get_json())

    def test_dashboard_stats_admin_only_but_apprentice_own_stats_ok(self):
        for role in ("SOPORTE", "BIBLIOTECARIO", "ALMACENISTA", "APRENDIZ"):
            self.assertEqual(self.c.get("/api/v1/dashboard/stats", headers=self.H(self.make(role))).status_code, 403, role)
        self.assertEqual(self.c.get("/api/v1/dashboard/stats", headers=self.H(self.make("ADMIN"))).status_code, 200)
        self.assertEqual(self.c.get("/api/v1/dashboard/aprendiz/stats", headers=self.H(self.make())).status_code, 200)

    def test_maintenance_create_validates_instead_of_crashing(self):
        h = self.H(self.make("SOPORTE")); item = self.stocked_item(self.dep_bib)
        self.assertEqual(self.c.post("/api/v1/maintenance/", headers=h, json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/maintenance/", headers=h, json={"item_id": item.id}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/maintenance/", headers=h, json={"item_id": item.id, "description": "  "}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/maintenance/", headers=h, json={"item_id": 9999, "description": "x"}).status_code, 404)

    def test_errors_do_not_leak_internals(self):
        import unittest.mock as mock
        h = self.H(self.make("ADMIN"))
        with mock.patch("app.routes.dashboard_routes.Loan") as boom:
            boom.query.filter.side_effect = RuntimeError("SECRETO: SELECT * FROM users")
            boom.query.filter_by.side_effect = RuntimeError("SECRETO: SELECT * FROM users")
            boom.query.count.side_effect = RuntimeError("SECRETO: SELECT * FROM users")
            r = self.c.get("/api/v1/dashboard/stats", headers=h)
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("SECRETO", r.get_data(as_text=True))
        self.assertNotIn("SELECT", r.get_data(as_text=True))

    def test_unhandled_exception_returns_generic_json(self):
        import unittest.mock as mock
        h = self.H(self.make())
        with mock.patch("app.routes.notification_routes.Notification") as boom:
            boom.query.filter_by.side_effect = RuntimeError("SECRETO: password=abc")
            r = self.c.get("/api/v1/notifications/unread-count", headers=h)
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("SECRETO", r.get_data(as_text=True))

    def test_http_errors_keep_their_status(self):
        r = self.c.post("/api/v1/auth/login", data="no-es-json", content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertNotIn("Traceback", r.get_data(as_text=True))


class TestSupportChatRoutes(RouteCase):
    def setUp(self):
        super().setUp()
        self.ap = self.make()
        self.sup = self.make("SOPORTE")
        self.other = self.make()

    def escalate(self, **kw):
        return self.c.post("/api/v1/chat/escalate", headers=self.H(self.ap),
                           json={"user_query": "no puedo reservar", "ai_response": "n/a", "thread_id": "thread_1", **kw})

    def test_escalate_creates_open_ticket_and_notifies_support(self):
        r = self.escalate()
        self.assertEqual(r.status_code, 201)
        t = Ticket.query.get(r.get_json()["ticket_id"])
        self.assertEqual((t.status, t.source_thread_id, t.user_id), ("OPEN", "thread_1", self.ap.id))
        self.assertEqual(TicketMessage.query.filter_by(ticket_id=t.id).count(), 1)
        self.assertTrue(Notification.query.filter_by(user_id=self.sup.id, type="TICKET_CREATED").count())

    def test_escalate_needs_query(self):
        r = self.c.post("/api/v1/chat/escalate", headers=self.H(self.ap), json={})
        self.assertEqual(r.status_code, 400)

    def test_active_ticket_only_when_in_progress(self):
        tid = self.escalate().get_json()["ticket_id"]
        self.assertIsNone(self.c.get("/api/v1/chat/tickets/active", headers=self.H(self.ap)).get_json()["active_ticket"])
        self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(self.sup))
        act = self.c.get("/api/v1/chat/tickets/active", headers=self.H(self.ap)).get_json()["active_ticket"]
        self.assertEqual((act["id"], act["source_thread_id"]), (tid, "thread_1"))
        self.assertIsNone(self.c.get("/api/v1/chat/tickets/active", headers=self.H(self.other)).get_json()["active_ticket"])

    def test_only_support_can_accept_and_only_once(self):
        tid = self.escalate().get_json()["ticket_id"]
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(self.ap)).status_code, 403)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(self.sup)).status_code, 200)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(self.sup)).status_code, 400)

    def test_message_access_rules(self):
        tid = self.escalate().get_json()["ticket_id"]
        self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(self.sup))
        self.assertEqual(self.c.get(f"/api/v1/chat/tickets/{tid}/messages", headers=self.H(self.other)).status_code, 403)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/messages", json={"body": "hola"}, headers=self.H(self.other)).status_code, 403)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/messages", json={"body": "hola"}, headers=self.H(self.sup)).status_code, 201)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/messages", json={"body": "  "}, headers=self.H(self.ap)).status_code, 400)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/messages", json={"body": "x" * 4001}, headers=self.H(self.ap)).status_code, 400)
        msgs = self.c.get(f"/api/v1/chat/tickets/{tid}/messages", headers=self.H(self.ap)).get_json()["messages"]
        self.assertEqual([m["is_mine"] for m in msgs], [True, False])

    def test_close_and_satisfaction_flow(self):
        tid = self.escalate().get_json()["ticket_id"]
        self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(self.sup))
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/satisfaction", json={"useful": True}, headers=self.H(self.ap)).status_code, 400)
        self.assertEqual(self.c.put(f"/api/v1/chat/tickets/{tid}/close", headers=self.H(self.ap)).status_code, 403)
        self.assertEqual(self.c.put(f"/api/v1/chat/tickets/{tid}/close", headers=self.H(self.sup)).status_code, 200)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/messages", json={"body": "hola"}, headers=self.H(self.ap)).status_code, 400)
        pend = self.c.get("/api/v1/chat/tickets/pending-feedback", headers=self.H(self.ap)).get_json()["pending_ticket"]
        self.assertEqual(pend["id"], tid)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/satisfaction", json={}, headers=self.H(self.ap)).status_code, 400)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/satisfaction", json={"useful": False}, headers=self.H(self.other)).status_code, 403)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/satisfaction", json={"useful": False}, headers=self.H(self.ap)).status_code, 200)
        self.assertEqual(Ticket.query.get(tid).satisfaction, "not_useful")
        self.assertIsNone(self.c.get("/api/v1/chat/tickets/pending-feedback", headers=self.H(self.ap)).get_json()["pending_ticket"])

    def test_staff_chat_blocked_for_apprentices(self):
        self.assertEqual(self.c.get("/api/v1/chat/staff/contacts", headers=self.H(self.ap)).status_code, 403)
        alm = self.make("ALMACENISTA")
        self.assertEqual(self.c.get("/api/v1/chat/staff/contacts", headers=self.H(alm)).status_code, 200)
        self.assertEqual(self.c.post(f"/api/v1/chat/staff/messages/{self.ap.id}", json={"body": "x"}, headers=self.H(alm)).status_code, 403)
        self.assertEqual(self.c.post(f"/api/v1/chat/staff/messages/{self.sup.id}", json={"body": "x"}, headers=self.H(alm)).status_code, 201)

    def test_my_tickets(self):
        self.escalate()
        self.assertEqual(len(self.c.get("/api/v1/chat/tickets/mine", headers=self.H(self.ap)).get_json()), 1)
        self.assertEqual(self.c.get("/api/v1/chat/tickets/mine", headers=self.H(self.other)).get_json(), [])


class TestAssistantThreadRoutes(RouteCase):
    def test_thread_crud_and_isolation(self):
        a, b = self.make(), self.make()
        msgs = [{"id": "1", "sender": "user", "text": "hola"}]
        r = self.c.post("/api/v1/assistant/threads", headers=self.H(a), json={"id": "thread_x", "title": "T", "messages": msgs})
        self.assertIn(r.status_code, (200, 201), r.get_json())
        lst = self.c.get("/api/v1/assistant/threads", headers=self.H(a)).get_json()
        self.assertEqual([t["id"] for t in lst], ["thread_x"])
        self.assertEqual(lst[0]["messages"], msgs)
        self.assertEqual(self.c.get("/api/v1/assistant/threads", headers=self.H(b)).get_json(), [])
        upd = self.c.put("/api/v1/assistant/threads/thread_x", headers=self.H(a), json={"title": "N", "messages": msgs + msgs})
        self.assertEqual(upd.status_code, 200)
        self.assertEqual(len(self.c.get("/api/v1/assistant/threads", headers=self.H(a)).get_json()[0]["messages"]), 2)
        self.assertIn(self.c.delete("/api/v1/assistant/threads/thread_x", headers=self.H(b)).status_code, (403, 404))
        self.assertEqual(len(self.c.get("/api/v1/assistant/threads", headers=self.H(a)).get_json()), 1)
        self.assertEqual(self.c.delete("/api/v1/assistant/threads/thread_x", headers=self.H(a)).status_code, 200)
        self.assertEqual(self.c.get("/api/v1/assistant/threads", headers=self.H(a)).get_json(), [])

    def test_threads_require_auth(self):
        self.assertEqual(self.c.get("/api/v1/assistant/threads").status_code, 401)


class TestHealthAndMisc(RouteCase):
    def test_unknown_api_route_is_404_json_or_html(self):
        self.assertEqual(self.c.get("/api/v1/no-existe").status_code, 404)

    def test_dashboard_requires_auth(self):
        r = self.c.get("/api/v1/dashboard/stats")
        self.assertIn(r.status_code, (401, 404))


if __name__ == "__main__":
    unittest.main(verbosity=2)
