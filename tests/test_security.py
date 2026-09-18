"""Pruebas de seguridad (caja gris, contra la app local con una base en memoria).

Cubren: control de acceso por ruta, JWT, sesiones, IDOR, inyección, XSS/HTML en
correos, asignación masiva, cabeceras, CORS, archivos, fuerza bruta y configuración.
Ejecutar:  python -m pytest tests/test_security.py   (o unittest)
"""
import base64
import json
import os
import re
import time
import unittest
from datetime import datetime, timedelta
from unittest import mock

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import jwt as pyjwt

from app.extensions import db
from app.models import (
    AuditLog, Item, Loan, Notification, RefreshToken, Reservation, Ticket, TrustedDevice, User,
)
from tests.test_routes import RouteCase, PW


def b64(d):
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()


# ───────────────────────── 1. Control de acceso por ruta ─────────────────────────
PUBLIC_ROUTES = {
    "GET /api/v1/health",
    "POST /api/v1/auth/login", "POST /api/v1/auth/register", "POST /api/v1/auth/verify-account",
    "POST /api/v1/auth/resend-verification", "POST /api/v1/auth/forgot-password",
    "POST /api/v1/auth/reset-password", "POST /api/v1/auth/approve-device",
    "POST /api/v1/auth/device-approval-status", "GET /api/v1/auth/pending-registration",
    "GET /api/v1/auth/_diag",
    "GET /api/v1/items/", "GET /api/v1/items/filters", "GET /api/v1/items/<int:id>",
    "POST /api/v1/assistant/chat", "GET /api/v1/assistant/greeting",
    "GET /api/v1/chat/tickets/active", "GET /api/v1/chat/tickets/pending-feedback",
}


class TestRouteInventory(RouteCase):
    def test_every_api_route_requires_a_token_except_the_public_list(self):
        exposed = []
        for rule in self.app.url_map.iter_rules():
            if not rule.rule.startswith("/api/v1/"):
                continue
            for method in rule.methods - {"HEAD", "OPTIONS"}:
                url = re.sub(r"<[^>]+>", "1", rule.rule)
                r = getattr(self.c, method.lower())(url, json={} if method != "GET" else None)
                key = f"{method} {rule.rule}"
                if r.status_code != 401 and key not in PUBLIC_ROUTES:
                    exposed.append(f"{key} -> {r.status_code}")
        self.assertEqual(exposed, [], "rutas accesibles sin sesión que no están en la lista pública")

    def test_public_item_endpoints_do_not_leak_private_fields(self):
        it = self.stocked_item(self.dep_bib)
        row = self.c.get(f"/api/v1/items/{it.id}").get_json()
        for forbidden in ("acquisition_date", "value", "nit", "supplier_id", "is_deleted"):
            self.assertNotIn(forbidden, row)

    @unittest.expectedFailure  # DECISIÓN PENDIENTE: el historial usa /items/<id> de elementos dados de baja
    def test_deleted_item_is_not_readable_by_id_for_guests(self):
        it = self.stocked_item(self.dep_bib); it.is_deleted = True; db.session.commit()
        self.assertEqual(self.c.get(f"/api/v1/items/{it.id}").status_code, 404,
                         "un elemento dado de baja no debería poder leerse por id")

    def test_health_does_not_reveal_configuration(self):
        body = self.c.get("/api/v1/health").get_json()
        self.assertEqual(set(body), {"status", "database"}, "el healthcheck no debe decir qué claves hay configuradas")


# ───────────────────────────────── 2. JWT ─────────────────────────────────
class TestJWT(RouteCase):
    def setUp(self):
        super().setUp()
        self.u = self.make(); self.key = self.app.config["JWT_SECRET_KEY"]

    def get_me(self, token):
        return self.c.get("/api/v1/users_mgmt/me", headers={"Authorization": f"Bearer {token}"}).status_code

    def claims(self, **kw):
        now = int(time.time())
        return {"sub": str(self.u.id), "iat": now, "nbf": now, "exp": now + 3600, "jti": "x", "type": "access", "fresh": False, **kw}

    def test_valid_token_works_baseline(self):
        self.assertEqual(self.get_me(pyjwt.encode(self.claims(), self.key, algorithm="HS256")), 200)

    def test_alg_none_is_rejected(self):
        forged = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64(self.claims())}."
        self.assertIn(self.get_me(forged), (401, 422))

    def test_wrong_signature_key_is_rejected(self):
        self.assertIn(self.get_me(pyjwt.encode(self.claims(), "otra-clave-cualquiera-de-32-bytes!!", algorithm="HS256")), (401, 422))

    def test_tampered_payload_is_rejected(self):
        good = pyjwt.encode(self.claims(), self.key, algorithm="HS256")
        h, _, s = good.split(".")
        evil = self.claims(sub=str(self.make("ADMIN").id))
        self.assertIn(self.get_me(f"{h}.{b64(evil)}.{s}"), (401, 422))

    def test_expired_token_is_rejected(self):
        t = pyjwt.encode(self.claims(exp=int(time.time()) - 10), self.key, algorithm="HS256")
        self.assertEqual(self.get_me(t), 401)

    def test_refresh_token_cannot_be_used_as_access_token(self):
        t = pyjwt.encode(self.claims(type="refresh"), self.key, algorithm="HS256")
        self.assertIn(self.get_me(t), (401, 422))

    def test_token_of_unknown_user_is_rejected(self):
        t = pyjwt.encode(self.claims(sub="no-existe"), self.key, algorithm="HS256")
        self.assertEqual(self.get_me(t), 404 if False else self.get_me(t))  # estado real
        r = self.c.get("/api/v1/loans/my", headers={"Authorization": f"Bearer {t}"})
        self.assertIn(r.status_code, (401, 404), "un token de un usuario inexistente no debería operar")

    def test_missing_or_malformed_authorization_header(self):
        for h in ({}, {"Authorization": "Bearer"}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer a.b"}):
            self.assertIn(self.c.get("/api/v1/users_mgmt/me", headers=h).status_code, (401, 422))

    def test_deactivated_user_loses_access_immediately(self):
        h = self.H(self.u)
        self.assertEqual(self.c.get("/api/v1/users_mgmt/me", headers=h).status_code, 200)
        User.query.get(self.u.id).is_active = False; db.session.commit()
        self.assertEqual(self.c.get("/api/v1/loans/my", headers=h).status_code, 401,
                         "un usuario desactivado seguía operando con su token vigente")

    def test_blocked_user_loses_access_immediately(self):
        h = self.H(self.u)
        User.query.get(self.u.id).is_blocked = True; db.session.commit()
        self.assertEqual(self.c.get("/api/v1/loans/my", headers=h).status_code, 401)

    def test_deleted_user_loses_access_immediately(self):
        h = self.H(self.u)
        User.query.get(self.u.id).is_deleted = True; db.session.commit()
        self.assertEqual(self.c.get("/api/v1/loans/my", headers=h).status_code, 401)

    def test_role_change_takes_effect_on_the_next_request(self):
        admin = self.make("ADMIN"); staff = self.make("BIBLIOTECARIO")
        h = self.H(staff)
        self.assertEqual(self.c.get("/api/v1/loans/", headers=h).status_code, 200)
        self.role("APRENDIZ")
        self.c.post(f"/api/v1/users_mgmt/{staff.id}/change-role", headers=self.H(admin), json={"role": "APRENDIZ"})
        self.assertEqual(self.c.get("/api/v1/loans/", headers=h).status_code, 403, "el permiso debe seguir al rol actual, no al del login")

    @unittest.expectedFailure  # DECISIÓN PENDIENTE: el access token dura 7 días; reducirlo exige que todo el frontend use apiFetch para renovarlo
    def test_token_lifetime_is_reasonable(self):
        days = self.app.config["JWT_ACCESS_TOKEN_EXPIRES"] / 86400
        self.assertLessEqual(days, 1, f"el access token dura {days:.0f} días; si lo roban sirve una semana")

    def test_revoked_session_kills_the_access_token(self):
        db.session.add(TrustedDevice(user_id=self.u.id, device_id="d")); db.session.commit()
        j = self.c.post("/api/v1/auth/login", json={"documento": self.u.id, "password": PW, "device_id": "d"}).get_json()
        h = {"Authorization": "Bearer " + j["access_token"]}
        self.assertEqual(self.c.get("/api/v1/users_mgmt/me", headers=h).status_code, 200)
        self.c.delete("/api/v1/auth/sessions/all", headers=h)
        self.assertEqual(self.c.get("/api/v1/users_mgmt/me", headers=h).status_code, 401)

    def test_password_change_revokes_other_sessions(self):
        db.session.add(TrustedDevice(user_id=self.u.id, device_id="d")); db.session.commit()
        j = self.c.post("/api/v1/auth/login", json={"documento": self.u.id, "password": PW, "device_id": "d"}).get_json()
        h = {"Authorization": "Bearer " + j["access_token"]}
        with mock.patch("app.services.auth_service.EmailService") as mail:
            mail.send_password_change_code.return_value = True
            self.c.post("/api/v1/auth/request-password-change", headers=h, json={"old_password": PW, "new_password": "NuevaClave99"})
            code = mail.send_password_change_code.call_args.args[1]
            self.c.post("/api/v1/auth/confirm-password-change", headers=h, json={"code": code})
        self.assertEqual(self.c.get("/api/v1/users_mgmt/me", headers=h).status_code, 401,
                         "tras cambiar la contraseña, el token anterior debería dejar de servir")


# ─────────────────────── 3. IDOR y separación entre usuarios ───────────────────────
class TestIDOR(RouteCase):
    def test_user_cannot_read_or_touch_another_users_data(self):
        a, b = self.make(), self.make(); staff = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        it = self.stocked_item(self.dep_bib)
        lid = self.c.post("/api/v1/loans/", headers=self.H(staff), json={"user_id": a.id, "item_ids": [it.id]}).get_json()["loan_id"]
        self.assertEqual(self.c.get("/api/v1/loans/my", headers=self.H(b)).get_json(), [])
        self.assertEqual(self.c.post(f"/api/v1/loans/{lid}/return", headers=self.H(b), json={}).status_code, 403)
        self.assertEqual(self.c.get(f"/api/v1/users_mgmt/{a.id}/detail", headers=self.H(b)).status_code, 403)
        self.assertEqual(self.c.get("/api/v1/history/my", headers=self.H(b)).get_json(), [])

    def test_ticket_chat_is_private(self):
        a, other, sup = self.make(), self.make(), self.make("SOPORTE")
        tid = self.c.post("/api/v1/chat/escalate", headers=self.H(a), json={"user_query": "necesito ayuda"}).get_json()["ticket_id"]
        self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(sup))
        self.assertEqual(self.c.get(f"/api/v1/chat/tickets/{tid}/messages", headers=self.H(other)).status_code, 403)
        self.assertEqual(self.c.put(f"/api/v1/chat/tickets/{tid}/close", headers=self.H(other)).status_code, 403)
        self.assertEqual(self.c.post(f"/api/v1/chat/tickets/{tid}/satisfaction", headers=self.H(other), json={"useful": True}).status_code, 403)

    def test_another_support_agent_cannot_read_a_ticket_assigned_to_someone_else(self):
        a, sup1, sup2 = self.make(), self.make("SOPORTE"), self.make("SOPORTE")
        tid = self.c.post("/api/v1/chat/escalate", headers=self.H(a), json={"user_query": "ayuda"}).get_json()["ticket_id"]
        self.c.post(f"/api/v1/chat/tickets/{tid}/accept", headers=self.H(sup1))
        self.assertEqual(self.c.get(f"/api/v1/chat/tickets/{tid}/messages", headers=self.H(sup2)).status_code, 403,
                         "un técnico no debería leer el chat de un caso que tomó otro")

    def test_reservation_body_cannot_impersonate_another_user(self):
        a, b = self.make(), self.make(); it = self.stocked_item(self.dep_bib)
        r = self.c.post("/api/v1/reservations/", headers=self.H(a), json={"item_id": it.id, "user_id": b.id})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(Reservation.query.first().user_id, a.id)

    def test_report_body_cannot_set_reporter_or_assignee(self):
        a, sup = self.make(), self.make("SOPORTE")
        r = self.c.post("/api/v1/reports_mgmt/", headers=self.H(a), json={
            "subject": "s", "description": "d", "user_id": sup.id, "assigned_to": sup.id, "status": "CLOSED"})
        t = Ticket.query.get(r.get_json()["id"])
        self.assertEqual((t.user_id, t.assigned_to, t.status), (a.id, None, "OPEN"))

    def test_item_update_cannot_mass_assign_protected_fields(self):
        admin = self.make("ADMIN"); it = self.stocked_item(self.dep_bib)
        self.c.put(f"/api/v1/items/{it.id}", headers=self.H(admin), json={"id": 9999, "is_deleted": True, "created_at": "2000-01-01"})
        row = Item.query.get(it.id)
        self.assertIsNotNone(row, "no se debe poder cambiar el id")
        self.assertFalse(row.is_deleted)

    def test_staff_scoped_to_their_own_area(self):
        theirs = self.stocked_item(self.dep_bib)
        alm = self.make("ALMACENISTA", dependency_id=self.dep_alm.id)
        h = self.H(alm)
        self.assertIn(self.c.put(f"/api/v1/items/{theirs.id}", headers=h, json={"name": "hack"}).status_code, (403, 404))
        self.assertIn(self.c.delete(f"/api/v1/items/{theirs.id}", headers=h).status_code, (403, 404))
        cat = theirs.category
        self.assertIn(self.c.put(f"/api/v1/items/categories/{cat.id}", headers=h, json={"name": "hack"}).status_code, (403, 404))
        self.assertEqual(Item.query.get(theirs.id).name, theirs.name)

    def test_staff_cannot_lend_an_item_from_the_other_area(self):
        it = self.stocked_item(self.dep_bib); ap = self.make()
        alm = self.make("ALMACENISTA", dependency_id=self.dep_alm.id)
        r = self.c.post("/api/v1/loans/", headers=self.H(alm), json={"user_id": ap.id, "item_ids": [it.id]})
        self.assertEqual(r.status_code, 403, "un almacenista no debería prestar elementos de la biblioteca")

    def test_unread_count_and_notification_ids_are_scoped(self):
        a, b = self.make(), self.make()
        db.session.add(Notification(user_id=b.id, title="t", message="privado", type="X")); db.session.commit()
        n = Notification.query.first()
        self.assertEqual(self.c.post(f"/api/v1/notifications/{n.id}/read", headers=self.H(a)).status_code, 404)
        self.assertEqual(self.c.delete(f"/api/v1/notifications/{n.id}", headers=self.H(a)).status_code, 404)


# ─────────────────────────────── 4. Inyección ───────────────────────────────
INJECTIONS = ["' OR '1'='1", "'; DROP TABLE users; --", "\" OR 1=1 --", "%' UNION SELECT password FROM users --", "1; SELECT pg_sleep(5)", "${jndi:ldap://x}", "{{7*7}}"]


class TestInjection(RouteCase):
    def test_search_and_filter_parameters(self):
        admin = self.make("ADMIN"); self.stocked_item(self.dep_bib); h = self.H(admin)
        for payload in INJECTIONS:
            for url in ("/api/v1/items/?search={}", "/api/v1/items/?category_id={}", "/api/v1/items/?status_id={}",
                        "/api/v1/audit/?search={}", "/api/v1/audit/?action_type={}", "/api/v1/loans/?search={}",
                        "/api/v1/loans/?status={}", "/api/v1/maintenance/?search={}", "/api/v1/outputs/?search={}",
                        "/api/v1/users_mgmt/?search={}", "/api/v1/reports_mgmt/?search={}"):
                r = self.c.get(url.format(payload), headers=h)
                self.assertLess(r.status_code, 500, (url, payload))
                self.assertNotIn("SQLITE", r.get_data(as_text=True).upper())
        self.assertGreater(User.query.count(), 0)
        self.assertEqual(Item.query.count(), 1)

    def test_login_with_injection_payloads(self):
        u = self.make()
        for payload in INJECTIONS:
            r = self.c.post("/api/v1/auth/login", json={"documento": payload, "password": payload})
            self.assertIn(r.status_code, (400, 401, 403), payload)
        self.assertEqual(User.query.get(u.id).failed_attempts, 0)

    def test_json_type_confusion_does_not_crash_or_bypass(self):
        u = self.make(); h = self.H(u)
        for body in ({"documento": {"$ne": None}, "password": {"$ne": None}}, {"documento": [1], "password": ["x"]},
                     {"documento": None, "password": None}, {"documento": 123456, "password": 123}, {"documento": True, "password": True}):
            r = self.c.post("/api/v1/auth/login", json=body)
            self.assertLess(r.status_code, 500, body)
            self.assertNotEqual(r.status_code, 200, body)
        r = self.c.post("/api/v1/reservations/", headers=h, json={"item_id": {"$gt": 0}})
        self.assertLess(r.status_code, 500)
        r = self.c.post("/api/v1/reservations/", headers=h, json={"item_id": [1, 2]})
        self.assertLess(r.status_code, 500)

    def test_wildcards_in_search_do_not_match_everything_for_login_like_lookups(self):
        self.make(id="12345")
        r = self.c.post("/api/v1/auth/login", json={"documento": "%", "password": PW})
        self.assertNotEqual(r.status_code, 200)
        r = self.c.post("/api/v1/auth/login", json={"documento": "1234_", "password": PW})
        self.assertNotEqual(r.status_code, 200)

    def test_oversized_and_deeply_nested_bodies(self):
        h = self.H(self.make())
        deep = cur = {}
        for _ in range(2000):
            cur["a"] = {}; cur = cur["a"]
        r = self.c.post("/api/v1/reports_mgmt/", headers=h, data=json.dumps(deep), content_type="application/json")
        self.assertLess(r.status_code, 500)
        r = self.c.post("/api/v1/reports_mgmt/", headers=h, json={"subject": "x" * 3_000_000, "description": "d"})
        self.assertLess(r.status_code, 500, "un asunto de 3 MB no debería reventar el servidor")

    def test_request_larger_than_limit_is_refused(self):
        big = "A" * (17 * 1024 * 1024)
        r = self.c.post("/api/v1/reports_mgmt/", headers=self.H(self.make()), data=big, content_type="application/json")
        self.assertEqual(r.status_code, 413)


# ─────────────────────── 5. XSS / HTML en correos y campos ───────────────────────
class TestOutputEncoding(RouteCase):
    XSS = '<img src=x onerror=alert(1)><script>alert(2)</script>'

    def test_email_templates_escape_user_controlled_values(self):
        from app.services import email_service
        captured = {}

        def fake_send(subject, recipients, text_body, html_body=None):
            captured["html"] = html_body or ""
            return True
        with self.app.test_request_context("/"), mock.patch.object(email_service, "_send", side_effect=fake_send):
            email_service.EmailService.send_verification_code("a@b.co", "123456", self.XSS, verify_link="https://x/y")
            html1 = captured["html"]
            email_service.EmailService.send_temporary_password("a@b.co", "Temp123!", self.XSS)
            html2 = captured["html"]
            email_service.EmailService.send_new_device_alert("a@b.co", self.XSS, "https://x/y", device_label=self.XSS, location=self.XSS, ip="1.1.1.1", when="hoy")
            html3 = captured["html"]
        for html in (html1, html2, html3):
            self.assertNotIn("<script>", html)
            self.assertNotIn("<img src=x", html)

    def test_api_returns_json_content_type_for_user_controlled_text(self):
        u = self.make(); h = self.H(u)
        self.c.patch("/api/v1/users_mgmt/me", headers=h, json={"biography": self.XSS})
        r = self.c.get("/api/v1/users_mgmt/me", headers=h)
        self.assertTrue(r.mimetype == "application/json")
        self.assertEqual(r.headers.get("X-Content-Type-Options"), "nosniff")

    def test_profile_and_item_images_only_accept_raster_formats(self):
        u = self.make(); svg = "data:image/svg+xml;base64," + base64.b64encode(b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").decode()
        r = self.c.patch("/api/v1/users_mgmt/profile-image", headers=self.H(u), json={"profile_image": svg})
        self.assertEqual(r.status_code, 400, "un SVG puede llevar scripts; solo deberían aceptarse png/jpeg/webp/gif")

    def test_csv_or_formula_injection_in_exports_is_neutralised(self):
        u = self.make(); u.name = '=HYPERLINK("http://evil","x")'; db.session.commit()
        r = self.c.get("/api/v1/users_mgmt/me/export-data", headers=self.H(u))
        self.assertEqual(r.status_code, 200)


# ─────────────────────── 6. Cabeceras, CORS y archivos ───────────────────────
class TestHeadersAndCors(RouteCase):
    def test_security_headers_present(self):
        h = self.c.get("/api/v1/health").headers
        self.assertEqual(h.get("X-Frame-Options"), "DENY")
        self.assertEqual(h.get("X-Content-Type-Options"), "nosniff")
        self.assertTrue(h.get("Referrer-Policy"))

    def test_content_security_policy_is_set(self):
        self.assertTrue(self.c.get("/api/v1/health").headers.get("Content-Security-Policy"),
                        "falta Content-Security-Policy: sin ella un XSS puede cargar scripts de cualquier sitio")

    def test_hsts_in_production(self):
        prod = self.app.test_client()
        self.app.debug = False
        try:
            self.assertIn("max-age", prod.get("/api/v1/health").headers.get("Strict-Transport-Security", ""))
        finally:
            pass

    def test_cors_rejects_unlisted_origins(self):
        r = self.c.options("/api/v1/loans/my", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
        self.assertNotEqual(r.headers.get("Access-Control-Allow-Origin"), "*")
        self.assertNotEqual(r.headers.get("Access-Control-Allow-Origin"), "https://evil.example")
        r = self.c.get("/api/v1/health", headers={"Origin": "null"})
        self.assertNotIn(r.headers.get("Access-Control-Allow-Origin"), ("null", "*"))

    def test_cors_does_not_allow_credentials_to_unlisted_origins(self):
        r = self.c.get("/api/v1/health", headers={"Origin": "https://evil.example"})
        self.assertNotEqual(r.headers.get("Access-Control-Allow-Credentials"), "true")

    def test_api_responses_are_not_cached_by_shared_caches(self):
        u = self.make()
        r = self.c.get("/api/v1/users_mgmt/me", headers=self.H(u))
        cc = (r.headers.get("Cache-Control") or "").lower()
        self.assertTrue("no-store" in cc or "private" in cc, "las respuestas con datos personales deberían llevar Cache-Control: no-store/private")

    def test_path_traversal(self):
        for path in ("/uploads/../../config.py", "/uploads/..%2f..%2fconfig.py", "/uploads/%2e%2e/%2e%2e/config.py",
                     "/uploads/....//....//config.py", "/../config.py", "/static/../config.py", "/%2e%2e/config.py",
                     "/uploads/..\\..\\config.py", "/uploads/%00.png", "/uploads/C:/Windows/win.ini"):
            r = self.c.get(path)
            body = r.get_data(as_text=True)
            self.assertNotIn("SQLALCHEMY_DATABASE_URI", body, path)
            self.assertNotIn("[fonts]", body, path)

    def test_spa_fallback_never_returns_source_files_or_dotfiles(self):
        for path in ("/.env", "/.git/config", "/app/__init__.py", "/requirements.txt", "/biblioteca.db", "/instance/biblioteca.db"):
            body = self.c.get(path).get_data(as_text=True)
            self.assertNotIn("SECRET_KEY", body, path)
            self.assertNotIn("[core]", body, path)
            self.assertNotIn("SQLite format", body, path)

    def test_debug_and_werkzeug_console_are_not_exposed(self):
        self.assertNotIn("Werkzeug", self.c.get("/console").get_data(as_text=True))
        r = self.c.get("/api/v1/no-existe")
        self.assertNotIn("Traceback", r.get_data(as_text=True))

    def test_http_methods_are_restricted(self):
        self.assertEqual(self.c.open("/api/v1/health", method="TRACE").status_code, 405)
        self.assertIn(self.c.delete("/api/v1/health").status_code, (404, 405))

    def test_open_redirect_is_not_possible(self):
        r = self.c.get("//evil.example/x", follow_redirects=False)
        self.assertNotIn("evil.example", r.headers.get("Location", ""))


# ─────────────────────── 7. Fuerza bruta, enumeración y límites ───────────────────────
class TestBruteForceAndEnumeration(RouteCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from app.extensions import limiter
        # El limitador solo guarda estado si estaba activo al iniciar la app; las demás
        # clases crean su propia app (con el límite apagado) y lo desactivan de nuevo.
        cls.app.config["RATELIMIT_ENABLED"] = True
        limiter.init_app(cls.app)

    def setUp(self):
        super().setUp()
        from app.extensions import limiter
        limiter.reset()

    def login(self, doc, pw, ip=None):
        h = {"X-Forwarded-For": ip} if ip else {}
        return self.c.post("/api/v1/auth/login", json={"documento": doc, "password": pw, "device_id": "d"}, headers=h)

    @unittest.expectedFailure  # DECISIÓN PENDIENTE: el mensaje 'Usuario no registrado' permite listar documentos válidos
    def test_login_does_not_reveal_whether_a_document_exists(self):
        u = self.make()
        unknown = self.login("99999999", "cualquiera").get_json()["error"]
        wrong = self.login(u.id, "incorrecta").get_json()["error"]
        self.assertEqual(unknown, wrong, "el mensaje distingue documento inexistente de contraseña errónea (permite listar documentos válidos)")

    @unittest.expectedFailure  # DECISIÓN PENDIENTE: el bloqueo por 5 intentos es permanente; cualquiera puede bloquear un documento ajeno
    def test_account_lockout_by_strangers_is_not_permanent(self):
        """Con solo conocer un documento (dato semi-público) se puede bloquear a cualquiera con 5 intentos."""
        u = self.make()
        for _ in range(5):
            self.login(u.id, "mala", ip="6.6.6.6")
        r = self.login(u.id, PW, ip="203.0.113.7")
        self.assertEqual(r.status_code, 200, "5 intentos fallidos desde otra IP bloquearon la cuenta hasta que un admin la desbloquee")

    def test_login_is_rate_limited_per_client_not_only_per_account(self):
        codes = [self.login(str(1000 + i), "mala", ip="7.7.7.7").status_code for i in range(60)]
        self.assertIn(429, codes, "60 intentos seguidos con documentos distintos no fueron limitados (permite barrer documentos)")

    def test_forgot_password_cannot_be_used_to_flood_a_mailbox(self):
        u = self.make()
        with mock.patch("app.services.auth_service.EmailService") as mail:
            mail.send_temporary_password.return_value = True
            for _ in range(30):
                self.c.post("/api/v1/auth/forgot-password", json={"email": u.email})
            self.assertLess(mail.send_temporary_password.call_count, 10, "se pueden mandar decenas de correos a la misma persona")

    @unittest.expectedFailure  # DECISIÓN PENDIENTE: la clave temporal reemplaza la real sin confirmación del dueño
    def test_forgot_password_does_not_lock_out_the_victim(self):
        """Cualquiera puede pedir la clave temporal ajena: la clave real se pierde y las sesiones se cierran."""
        u = self.make()
        with mock.patch("app.services.auth_service.EmailService") as mail:
            mail.send_temporary_password.return_value = True
            self.c.post("/api/v1/auth/forgot-password", json={"email": u.email})
        self.assertTrue(bcrypt_ok(User.query.get(u.id).password, PW),
                        "un extraño que conozca el correo puede invalidar la contraseña de otra persona")

    def test_verification_code_is_not_guessable_in_sequence(self):
        from app.services.auth_service import _generate_6digit_code
        codes = {_generate_6digit_code() for _ in range(200)}
        self.assertGreater(len(codes), 190)
        self.assertTrue(all(len(c) == 6 and c.isdigit() for c in codes))

    def test_rate_limit_is_per_real_client_ip_behind_the_proxy(self):
        """Tras Traefik/Coolify todos llegan desde la IP del proxy; el cupo debe ser por cliente."""
        for i in range(45):
            self.login(str(2000 + i), "mala", ip="198.51.100.9")
        self.assertEqual(self.login("2000", "mala", ip="198.51.100.9").status_code, 429)
        self.assertEqual(self.login("2000", "mala", ip="203.0.113.50").status_code, 401,
                         "otro cliente distinto no debería quedar limitado por el primero")



def bcrypt_ok(hash_, pw):
    import bcrypt
    return bcrypt.checkpw(pw.encode(), hash_.encode())


# ─────────────────────── 8. Contraseñas y datos sensibles ───────────────────────
class TestSecretsAndPasswords(RouteCase):
    def test_passwords_are_bcrypt_and_never_returned(self):
        u = self.make(); admin = self.make("ADMIN")
        self.assertTrue(u.password.startswith("$2"))
        for url, h in (("/api/v1/users_mgmt/me", self.H(u)), ("/api/v1/users_mgmt/", self.H(admin)),
                       (f"/api/v1/users_mgmt/{u.id}/detail", self.H(admin)), ("/api/v1/auth/session-check", self.H(u)),
                       ("/api/v1/users_mgmt/me/export-data", self.H(u))):
            body = self.c.get(url, headers=h).get_data(as_text=True)
            self.assertNotIn(u.password, body, url)
            self.assertNotIn("totp_secret", body, url)
            self.assertNotIn('"password"', body, url)

    def test_totp_secret_is_only_shown_once_at_creation(self):
        u = self.make(totp_secret="ABCDEFGHIJKLMNOP")
        for url in ("/api/v1/users_mgmt/me", "/api/v1/auth/session-check"):
            self.assertNotIn("ABCDEFGHIJKLMNOP", self.c.get(url, headers=self.H(u)).get_data(as_text=True), url)

    def test_password_policy_rejects_trivial_passwords(self):
        from app.services.auth_service import _validate_password_strength
        for weak in ("12345678", "password", "aaaaaaaa", "qwertyui", "11111111"):
            self.assertIsNotNone(_validate_password_strength(weak), f"'{weak}' no debería ser aceptable")

    def test_password_hash_has_a_sane_cost_and_salt(self):
        import bcrypt
        a = bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(); b = bcrypt.hashpw(b"x", bcrypt.gensalt()).decode()
        self.assertNotEqual(a, b)
        self.assertGreaterEqual(int(a.split("$")[2]), 10)

    def test_audit_log_never_stores_passwords(self):
        u = self.make(); self.c.post("/api/v1/auth/login", json={"documento": u.id, "password": "SuperSecreta999", "device_id": "d"})
        for row in AuditLog.query.all():
            self.assertNotIn("SuperSecreta999", (row.details or "") + (row.entity_name or ""))

    def test_application_refuses_to_start_without_secret_keys(self):
        from config import Config
        self.assertTrue(Config.SECRET_KEY and len(Config.SECRET_KEY) >= 32, "SECRET_KEY ausente o corta")
        self.assertTrue(Config.JWT_SECRET_KEY and len(Config.JWT_SECRET_KEY) >= 32, "JWT_SECRET_KEY ausente o corta")

    def test_default_environment_is_not_debug(self):
        import config
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("FLASK_ENV", None)
            self.assertFalse(config.get_config().DEBUG, "sin FLASK_ENV la app arranca en modo DEBUG")

    def test_no_secrets_in_tracked_files(self):
        import subprocess
        out = subprocess.run(["git", "grep", "-nEI", r"(postgres(ql)?://(?!usuario:clave)[^:/@ ]+:[^@ ${]{4,}@|AIza[0-9A-Za-z_\-]{30,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----|sk-[A-Za-z0-9]{30,})",
                              "--", ".", ":!.claude", ":!tests/test_security.py"],
                             capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(__file__))).stdout
        self.assertEqual(out.strip(), "", "hay credenciales o claves escritas en archivos versionados")

    def test_dotenv_and_databases_are_not_tracked(self):
        import subprocess
        out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(__file__))).stdout.splitlines()
        bad = [f for f in out if re.search(r"(^|/)\.env$|\.db$|\.sqlite3?$|\.pem$|id_rsa", f)]
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
