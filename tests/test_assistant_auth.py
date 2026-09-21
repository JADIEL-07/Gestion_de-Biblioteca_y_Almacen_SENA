"""Tercera tanda: asistente (IA + acciones + panel de conocimiento + hilos) y flujos
de cuenta (registro, verificación, dispositivo nuevo, 2FA, recuperación de clave).

El correo y la geolocalización se simulan; Gemini nunca se llama (sin GEMINI_API_KEY
la ruta cae al modo de reglas). Ejecutar:  python -m unittest tests.test_assistant_auth -v
"""
import os
import unittest
from datetime import datetime, timedelta
from unittest import mock
from urllib.parse import urlparse, parse_qs

os.environ.pop("GEMINI_API_KEY", None)

import bcrypt
import pyotp

from app.extensions import db
from app.models import (
    User, Item, Reservation, Notification, AuditLog, RefreshToken, TrustedDevice,
    VerificationCode, PendingRegistration, AssistantThread, AILearnedResponse,
    AIUnansweredQuery, AIResponseFeedback, Loan,
)
from tests.test_routes import RouteCase, PW


class AssistantCase(RouteCase):
    def setUp(self):
        super().setUp()
        os.environ.pop("GEMINI_API_KEY", None)
        self.ap = self.make("APRENDIZ")
        self.admin = self.make("ADMIN")

    def chat(self, text, user="ap", **kw):
        headers = {}
        if user == "ap":
            headers = self.H(self.ap)
        elif user is not None and user != "guest":
            headers = self.H(user)
        self.c.application.config["BOT_CACHE"] = {}
        return self.c.post("/api/v1/assistant/chat", headers=headers, json={"message": text, "history": kw.get("history", [])})


class TestAssistantHelpers(unittest.TestCase):
    def test_classify_greeting(self):
        from app.routes.assistant_routes import classify_greeting
        self.assertEqual(classify_greeting("Hola, buenos días"), "greeting")
        self.assertEqual(classify_greeting("¿Quién eres?"), "identity")
        self.assertIsNone(classify_greeting("Hola, cómo puedo iniciar sesión"))
        self.assertIsNone(classify_greeting(""))
        self.assertIsNone(classify_greeting(None))

    def test_strip_leaked_tokens(self):
        from app.routes.assistant_routes import strip_leaked_tokens
        self.assertNotIn("borrow_tool", strip_leaked_tokens("Listo borrow_tool ✅"))
        self.assertEqual(strip_leaked_tokens("[ESCALAR_SOPORTE]"), "[ESCALAR_SOPORTE]")
        self.assertEqual(strip_leaked_tokens("nombre_de_variable_en `codigo_real`").count("codigo_real"), 1)
        self.assertEqual(strip_leaked_tokens(""), "")

    def test_strip_leading_greeting(self):
        from app.routes.assistant_routes import strip_leading_greeting
        out = strip_leading_greeting("¡Hola! Tu préstamo vence mañana a las 5 pm.")
        self.assertTrue(out.startswith("Tu préstamo"))
        short = "¡Hola! Sí."
        self.assertEqual(strip_leading_greeting(short), short, "no debe comerse toda la respuesta")

    def test_display_name(self):
        from app.routes.assistant_routes import assistant_display_name
        U = lambda **k: type("U", (), k)()
        self.assertEqual(assistant_display_name(None), "usuario")
        self.assertEqual(assistant_display_name(U(name="Ana María Ruiz", display_name="", email="a@b.c")), "Ana María Ruiz")
        self.assertEqual(assistant_display_name(U(name="Ana María Ruiz", display_name="Anita", email="a@b.c")), "Anita")
        self.assertEqual(assistant_display_name(U(name="Ana María Ruiz", display_name="", email="a@b.c"), first_name_only=True), "Ana")
        self.assertEqual(assistant_display_name(U(name="[PRUEBA] Aprendiz", display_name="", email="x@y.z")), "usuario")
        self.assertEqual(assistant_display_name(U(name="Real", display_name="", email="test@x.com")), "usuario")

    def test_keywords(self):
        from app.routes.assistant_routes import get_query_keywords
        self.assertEqual(get_query_keywords("¿Cómo reservo el libro de Python?"), "reservo libro python")

    def test_resolve_nav(self):
        from app.routes.assistant_routes import _resolve_nav
        nav = _resolve_nav("APRENDIZ", "mis préstamos")
        self.assertIsNotNone(nav)
        self.assertTrue(nav["route"].startswith("/"))
        self.assertIsNone(_resolve_nav("APRENDIZ", "zzzz qqqq"))
        self.assertIsNotNone(_resolve_nav("ROL_INEXISTENTE", "notificaciones"))


class TestAssistantChat(AssistantCase):
    def test_empty_message_rejected(self):
        self.assertEqual(self.chat("   ").status_code, 400)

    def test_guest_can_chat_in_rules_mode(self):
        r = self.chat("hola", user="guest")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["source"], "rules")

    def test_guest_never_gets_private_data_or_actions(self):
        r = self.chat("cuáles son mis préstamos", user="guest").get_json()
        self.assertIn("Invitado", r["text"])
        self.assertIsNone(r.get("metadata"))
        r = self.chat("llévame a mis préstamos", user="guest").get_json()
        self.assertNotEqual(r["type"], "navigate", "un invitado no debería recibir accesos directos del panel")

    def test_loans_listed_only_for_the_asker(self):
        staff = self.make("BIBLIOTECARIO", dependency_id=self.dep_bib.id)
        it = self.stocked_item(self.dep_bib); other = self.make()
        self.c.post("/api/v1/loans/", headers=self.H(staff), json={"user_id": self.ap.id, "item_ids": [it.id]})
        mine = self.chat("cuáles son mis préstamos").get_json()
        self.assertIn(it.name, mine["text"])
        theirs = self.chat("cuáles son mis préstamos", user=other).get_json()
        self.assertNotIn(it.name, theirs["text"])

    def test_navigation_shortcut(self):
        r = self.chat("llévame a mis reservas").get_json()
        self.assertEqual(r["type"], "navigate")
        self.assertTrue(r["route"])

    def test_role_boundaries_in_answers(self):
        admin_txt = self.chat("quiero crear usuario nuevo", user=self.admin).get_json()["text"]
        ap_txt = self.chat("quiero crear usuario nuevo").get_json()["text"]
        self.assertIn("Nuevo usuario", admin_txt)
        self.assertNotIn("Nuevo usuario", ap_txt)
        self.assertIn("Administrador", ap_txt)

    def test_unknown_question_is_logged_and_offers_support_to_apprentices(self):
        r = self.chat("zzz qqq xxx wwww").get_json()
        self.assertTrue(r["suggest_support"])
        self.assertEqual(AIUnansweredQuery.query.count(), 1)
        r = self.chat("zzz qqq xxx wwww", user=self.admin).get_json()
        self.assertFalse(r["suggest_support"], "el admin no escala a Soporte")

    def test_words_are_matched_as_words_not_substrings(self):
        """'ahora' contiene 'hora'; una pregunta sobre la contraseña no debe responder el horario."""
        txt = self.chat("quiero cambiar mi contraseña ahora").get_json()["text"]
        self.assertNotIn("Horarios de Atención", txt)

    def test_response_cache_is_per_user(self):
        other = self.make()
        self.c.application.config["BOT_CACHE"] = {}
        a = self.c.post("/api/v1/assistant/chat", headers=self.H(self.ap), json={"message": "zzz qqq xxx wwww"}).get_json()
        self.assertIn("text", a)
        keys = list(self.c.application.config.get("BOT_CACHE", {}).keys())
        self.assertTrue(all(str(self.ap.id) in k for k in keys) or not keys)

    def test_support_request_phrase_is_detected(self):
        r = self.chat("quiero hablar con soporte").get_json()
        self.assertTrue(r.get("suggest_support") or r.get("type") == "support_offer" or "Soporte" in r["text"])

    def test_sessions_and_reservations_shortcuts(self):
        r = self.chat("mis reservas").get_json()
        self.assertIn("reserva", r["text"].lower())
        r = self.chat("mis sesiones activas").get_json()
        self.assertIn("sesi", r["text"].lower())

    def test_huge_message_does_not_crash(self):
        r = self.chat("a" * 50000)
        self.assertLess(r.status_code, 500)


class TestAssistantActions(AssistantCase):
    def propose(self, fn, args, user=None):
        from app.routes.assistant_routes import _dispatch_assistant_tool
        user = user or self.ap
        with self.app.test_request_context(headers=self.H(user)):
            from flask_jwt_extended import verify_jwt_in_request
            verify_jwt_in_request()
            return _dispatch_assistant_tool(fn, args, user, "APRENDIZ")

    def confirm(self, token, user=None, confirm=True):
        return self.c.post("/api/v1/assistant/confirm-action", headers=self.H(user or self.ap),
                           json={"token": token, "confirm": confirm})

    def test_reserve_needs_explicit_confirmation(self):
        it = self.stocked_item(self.dep_bib); it.name = "Multímetro Fluke"; db.session.commit()
        p = self.propose("reservar_elemento", {"elemento": "Fluke"})
        self.assertEqual(p["type"], "confirm_action")
        self.assertEqual(Reservation.query.count(), 0, "proponer no debe reservar")
        self.assertEqual(self.confirm(p["token"], confirm=False).status_code, 200)
        self.assertEqual(Reservation.query.count(), 0)
        r = self.confirm(p["token"])
        self.assertEqual(r.status_code, 200)
        self.assertIn("Reserva creada", r.get_json()["text"])
        self.assertEqual(Reservation.query.filter_by(user_id=self.ap.id).count(), 1)

    def test_reserve_ambiguous_or_unknown(self):
        self.stocked_item(self.dep_bib); self.stocked_item(self.dep_bib)
        self.assertIn("varios", self.propose("reservar_elemento", {"elemento": "Item"})["text"])
        self.assertIn("No encontré", self.propose("reservar_elemento", {"elemento": "inexistente"})["text"])
        self.assertIn("nombre", self.propose("reservar_elemento", {"elemento": ""})["text"].lower())

    def test_token_bound_to_the_user_and_tamper_proof(self):
        self.stocked_item(self.dep_bib)
        p = self.propose("reservar_elemento", {"elemento": "Item"})
        other = self.make()
        self.assertEqual(self.confirm(p["token"], user=other).status_code, 403)
        self.assertEqual(self.confirm(p["token"][:-3] + "abc").status_code, 400)
        self.assertEqual(self.confirm("basura").status_code, 400)
        self.assertEqual(self.c.post("/api/v1/assistant/confirm-action", headers=self.H(self.ap), json={}).status_code, 400)
        self.assertEqual(Reservation.query.count(), 0)

    def test_expired_token_is_not_executed(self):
        self.stocked_item(self.dep_bib)
        p = self.propose("reservar_elemento", {"elemento": "Item"})
        with mock.patch("app.routes.assistant_routes.ACTION_MAX_AGE", -1):
            r = self.confirm(p["token"])
        self.assertIn("expiró", r.get_json()["text"])
        self.assertEqual(Reservation.query.count(), 0)

    def test_cancel_flow(self):
        it = self.stocked_item(self.dep_bib)
        self.c.post("/api/v1/reservations/", headers=self.H(self.ap), json={"item_id": it.id})
        p = self.propose("cancelar_mi_reserva", {"elemento": it.name})
        self.assertEqual(p["type"], "confirm_action")
        self.assertIn("Cancelé", self.confirm(p["token"]).get_json()["text"])
        self.assertEqual(Reservation.query.first().status, "CANCELLED")
        self.assertIn("No tienes", self.propose("cancelar_mi_reserva", {"elemento": ""})["text"])
        self.assertIn("ya no", self.confirm(p["token"]).get_json()["text"].lower())

    def test_cannot_cancel_someone_elses_reservation_with_a_forged_payload(self):
        from itsdangerous import URLSafeTimedSerializer
        it = self.stocked_item(self.dep_bib); victim = self.make()
        rid = self.c.post("/api/v1/reservations/", headers=self.H(victim), json={"item_id": it.id}).get_json()["id"]
        from app.routes.assistant_routes import _action_serializer
        with self.app.app_context():
            token = _action_serializer().dumps({"action": "cancelar_reserva", "user_id": str(self.ap.id),
                                                 "params": {"reservation_id": rid, "item_name": it.name}})
        self.assertIn("ya no existe", self.confirm(token).get_json()["text"])
        self.assertEqual(Reservation.query.get(rid).status, "READY")

    def test_unknown_action_rejected(self):
        from app.routes.assistant_routes import _action_serializer
        with self.app.app_context():
            token = _action_serializer().dumps({"action": "borrar_todo", "user_id": str(self.ap.id), "params": {}})
        self.assertEqual(self.confirm(token).status_code, 400)

    def test_close_all_sessions(self):
        db.session.add(TrustedDevice(user_id=self.ap.id, device_id="dx")); db.session.commit()
        self.c.post("/api/v1/auth/login", json={"documento": self.ap.id, "password": PW, "device_id": "dx"})
        p = self.propose("cerrar_sesion_dispositivo", {"objetivo": "todas"})
        self.assertEqual(p["type"], "confirm_action")
        r = self.confirm(p["token"]).get_json()
        self.assertTrue(r["session_ended"] is False or r.get("session_ended") is True)
        self.assertEqual(RefreshToken.query.filter_by(user_id=self.ap.id, is_revoked=False).count(), 0)
        self.assertEqual(TrustedDevice.query.filter_by(user_id=self.ap.id).count(), 0)

    def test_unknown_tool(self):
        self.assertIn("No reconocí", self.propose("hackear", {})["text"])


class TestAssistantKnowledgePanel(AssistantCase):
    LONG_Q = "cómo restablezco mi contraseña olvidada del sistema"

    def test_admin_only(self):
        for role in ("APRENDIZ", "SOPORTE", "BIBLIOTECARIO"):
            h = self.H(self.make(role))
            for method, url in [("get", "/api/v1/assistant/learned"), ("get", "/api/v1/assistant/feedback"),
                                ("get", "/api/v1/assistant/unanswered"), ("post", "/api/v1/assistant/learned")]:
                self.assertEqual(getattr(self.c, method)(url, headers=h).status_code, 403, (role, url))

    def test_learned_crud(self):
        h = self.H(self.admin)
        self.assertEqual(self.c.post("/api/v1/assistant/learned", headers=h, json={"query_text": "hola"}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/assistant/learned", headers=h, json={"query_text": "hola", "response_text": "x"}).status_code, 400)
        r = self.c.post("/api/v1/assistant/learned", headers=h, json={"query_text": self.LONG_Q, "response_text": "Usa Olvidé mi contraseña.", "role": "aprendiz"})
        self.assertEqual(r.status_code, 201)
        eid = r.get_json()["id"]
        row = AILearnedResponse.query.get(eid)
        self.assertEqual((row.source, row.role), ("manual", "APRENDIZ"))
        lst = self.c.get("/api/v1/assistant/learned?search=contraseña", headers=h).get_json()
        self.assertEqual(lst["total"], 1)
        self.assertEqual(self.c.put(f"/api/v1/assistant/learned/{eid}", headers=h, json={"response_text": "Nueva"}).status_code, 200)
        self.assertEqual(AILearnedResponse.query.get(eid).response_text, "Nueva")
        self.assertEqual(self.c.put("/api/v1/assistant/learned/999", headers=h, json={}).status_code, 404)
        self.assertEqual(self.c.delete(f"/api/v1/assistant/learned/{eid}", headers=h).status_code, 200)
        self.assertEqual(self.c.delete(f"/api/v1/assistant/learned/{eid}", headers=h).status_code, 404)

    def test_bad_pagination_is_a_client_error(self):
        h = self.H(self.admin)
        for url in ("/api/v1/assistant/learned?page=abc", "/api/v1/assistant/feedback?per_page=xyz"):
            self.assertLess(self.c.get(url, headers=h).status_code, 500, url)

    def test_unanswered_resolve_and_delete(self):
        h = self.H(self.admin)
        self.chat("zzz qqq xxx wwww")
        uid = self.c.get("/api/v1/assistant/unanswered", headers=h).get_json()[0]["id"]
        self.assertEqual(self.c.put(f"/api/v1/assistant/unanswered/{uid}", headers=h).status_code, 200)
        self.assertEqual(self.c.get("/api/v1/assistant/unanswered", headers=h).get_json(), [])
        self.assertEqual(len(self.c.get("/api/v1/assistant/unanswered?pending=false", headers=h).get_json()), 1)
        self.assertEqual(self.c.delete(f"/api/v1/assistant/unanswered/{uid}", headers=h).status_code, 200)

    def test_feedback_general_and_learned_autodelete(self):
        h = self.H(self.ap)
        self.assertEqual(self.c.post("/api/v1/assistant/feedback", json={"useful": True}).status_code, 401)
        r = self.c.post("/api/v1/assistant/feedback", headers=h, json={"query_text": "q", "response_text": "r", "useful": False, "source": "gemini"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(AIResponseFeedback.query.count(), 1)
        entry = AILearnedResponse(query_text="q", query_keywords="q q q", response_text="r"); db.session.add(entry); db.session.commit()
        for _ in range(2):
            self.assertNotIn("deleted", self.c.post("/api/v1/assistant/feedback", headers=h, json={"learned_id": entry.id, "useful": False}).get_json())
        self.assertTrue(self.c.post("/api/v1/assistant/feedback", headers=h, json={"learned_id": entry.id, "useful": False}).get_json()["deleted"])
        self.assertEqual(self.c.post("/api/v1/assistant/feedback", headers=h, json={"learned_id": 999, "useful": True}).status_code, 404)

    def test_feedback_listing_totals(self):
        db.session.add_all([AIResponseFeedback(useful=True, query_text="a"), AIResponseFeedback(useful=False, query_text="b")]); db.session.commit()
        j = self.c.get("/api/v1/assistant/feedback?only=not_useful", headers=self.H(self.admin)).get_json()
        self.assertEqual((j["total"], j["total_useful"], j["total_not_useful"]), (1, 1, 1))


class TestAssistantThreadsExtra(AssistantCase):
    def test_creating_the_same_thread_twice_is_harmless(self):
        """El frontend crea el hilo al abrir 'Nueva conversación' y otra vez al primer mensaje."""
        h = self.H(self.ap)
        body = {"id": "thread_dup", "title": "T", "messages": []}
        self.assertEqual(self.c.post("/api/v1/assistant/threads", headers=h, json=body).status_code, 201)
        r = self.c.post("/api/v1/assistant/threads", headers=h, json=body)
        self.assertLess(r.status_code, 500, "crear dos veces el mismo hilo no debería ser un error del servidor")
        self.assertEqual(AssistantThread.query.filter_by(id="thread_dup").count(), 1)

    def test_thread_id_of_another_user_cannot_be_hijacked(self):
        a, b = self.make(), self.make()
        self.c.post("/api/v1/assistant/threads", headers=self.H(a), json={"id": "thread_a", "title": "privado", "messages": [{"text": "secreto"}]})
        r = self.c.post("/api/v1/assistant/threads", headers=self.H(b), json={"id": "thread_a", "title": "mío", "messages": []})
        self.assertLess(r.status_code, 500)
        row = AssistantThread.query.get("thread_a")
        self.assertEqual((row.user_id, row.title), (a.id, "privado"))
        self.assertEqual(self.c.get("/api/v1/assistant/threads", headers=self.H(b)).get_json(), [])

    def test_generic_usuario_role_keeps_no_history(self):
        u = self.make("USUARIO"); h = self.H(u)
        self.assertEqual(self.c.post("/api/v1/assistant/threads", headers=h, json={"id": "t1", "messages": [{"text": "x"}]}).status_code, 201)
        self.assertEqual(AssistantThread.query.count(), 0)
        self.assertEqual(self.c.get("/api/v1/assistant/threads", headers=h).get_json(), [])

    def test_updating_someone_elses_thread_is_404(self):
        a, b = self.make(), self.make()
        self.c.post("/api/v1/assistant/threads", headers=self.H(a), json={"id": "thread_x", "title": "T"})
        self.assertEqual(self.c.put("/api/v1/assistant/threads/thread_x", headers=self.H(b), json={"title": "hack"}).status_code, 404)
        self.assertEqual(self.c.delete("/api/v1/assistant/threads/thread_x", headers=self.H(b)).status_code, 404)
        self.assertEqual(AssistantThread.query.get("thread_x").title, "T")


class AccountCase(RouteCase):
    def setUp(self):
        super().setUp()
        self.role("APRENDIZ")
        p = mock.patch("app.services.auth_service.EmailService"); self.mail = p.start(); self.addCleanup(p.stop)
        for name in ("send_verification_code", "send_temporary_password", "send_password_change_code",
                     "send_new_device_alert", "send_2fa_code"):
            getattr(self.mail, name).return_value = True
        g = mock.patch("app.services.auth_service._geolocate", return_value=None); g.start(); self.addCleanup(g.stop)

    def reg(self, **kw):
        body = {"nombre": "Ana Ruiz", "email": "ana@sena.edu.co", "password": "Clave1234", "telefono": "3001234567",
                "document_type": "CC", "document_number": "1090000001", **kw}
        return self.c.post("/api/v1/auth/register", json=body)

    def sent_code(self):
        return self.mail.send_verification_code.call_args.args[1]


class TestRegistration(AccountCase):
    def test_happy_path_creates_user_only_after_verification(self):
        r = self.reg()
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual(User.query.filter_by(email="ana@sena.edu.co").count(), 0)
        self.assertEqual(PendingRegistration.query.count(), 1)
        code = self.sent_code(); self.assertRegex(code, r"^\d{6}$")
        v = self.c.post("/api/v1/auth/verify-account", json={"email": "ana@sena.edu.co", "code": code, "device_id": "dv1"})
        self.assertEqual(v.status_code, 200, v.get_json())
        j = v.get_json()
        self.assertTrue(j["access_token"] and j["refresh_token"] and j["totp_secret"])
        u = User.query.get("1090000001")
        self.assertEqual((u.role.name, u.is_verified, u.is_active), ("APRENDIZ", True, True))
        self.assertTrue(bcrypt.checkpw(b"Clave1234", u.password.encode()), "la contraseña se guarda con hash")
        self.assertEqual(PendingRegistration.query.count(), 0)
        self.assertEqual(TrustedDevice.query.filter_by(user_id=u.id, device_id="dv1").count(), 1)
        self.assertEqual(self.c.get("/api/v1/users_mgmt/me", headers={"Authorization": "Bearer " + j["access_token"]}).status_code, 200)

    def test_pending_row_never_stores_plain_password_or_code(self):
        self.reg()
        p = PendingRegistration.query.first()
        self.assertNotIn("Clave1234", p.payload)
        self.assertNotEqual(p.code_hash, self.sent_code())

    def test_validation(self):
        cases = [dict(password="corta"), dict(password="tiene espacios 1"), dict(email="no-es-correo"),
                 dict(telefono="123"), dict(document_number=""), dict(nombre="  ")]
        for kw in cases:
            self.assertEqual(self.reg(**kw).status_code, 400, kw)
        self.assertEqual(PendingRegistration.query.count(), 0)

    def test_duplicates(self):
        self.make(id="1090000001", email="otro@t.com")
        self.assertEqual(self.reg().status_code, 400, "documento repetido")
        self.make(email="ana@sena.edu.co")
        self.assertEqual(self.reg(document_number="777").status_code, 400, "correo repetido")

    def test_second_registration_for_same_email_is_blocked_while_pending(self):
        self.assertEqual(self.reg().status_code, 201)
        self.assertEqual(self.reg(document_number="222").status_code, 400)

    def test_email_failure_rolls_back_pending(self):
        self.mail.send_verification_code.return_value = False
        self.assertEqual(self.reg().status_code, 502)
        self.assertEqual(PendingRegistration.query.count(), 0)
        self.mail.send_verification_code.return_value = True
        self.assertEqual(self.reg().status_code, 201, "debe poder reintentar de inmediato")

    def test_client_cannot_choose_a_privileged_role(self):
        admin_role = self.role("ADMIN")
        r = self.reg(role_id=admin_role.id)
        self.assertEqual(r.status_code, 201)
        self.c.post("/api/v1/auth/verify-account", json={"email": "ana@sena.edu.co", "code": self.sent_code()})
        u = User.query.get("1090000001")
        self.assertEqual(u.role.name, "APRENDIZ", "un registro público no puede autoasignarse ADMIN")

    def test_wrong_code_counts_attempts_and_locks_after_five(self):
        self.reg(); good = self.sent_code(); bad = "000000" if good != "000000" else "111111"
        for i in range(5):
            r = self.c.post("/api/v1/auth/verify-account", json={"email": "ana@sena.edu.co", "code": bad})
            self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/v1/auth/verify-account", json={"email": "ana@sena.edu.co", "code": good})
        self.assertEqual(r.status_code, 400, "tras 5 fallos ni el código correcto debe servir")
        self.assertEqual(User.query.count(), 0)

    def test_expired_code(self):
        self.reg(); p = PendingRegistration.query.first(); p.expires_at = datetime.utcnow() - timedelta(minutes=1); db.session.commit()
        r = self.c.post("/api/v1/auth/verify-account", json={"email": "ana@sena.edu.co", "code": self.sent_code()})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(PendingRegistration.query.count(), 0)

    def test_verify_edge_inputs(self):
        self.assertEqual(self.c.post("/api/v1/auth/verify-account", json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/verify-account", json={"email": "x@y.co", "code": "123456"}).status_code, 404)

    def test_resend_regenerates_and_resets_attempts(self):
        self.reg(); first = self.sent_code()
        self.c.post("/api/v1/auth/verify-account", json={"email": "ana@sena.edu.co", "code": "000000"})
        self.assertEqual(self.c.post("/api/v1/auth/resend-verification", json={"email": "ana@sena.edu.co"}).status_code, 200)
        self.assertEqual(PendingRegistration.query.first().attempts, 0)
        self.assertEqual(self.mail.send_verification_code.call_count, 2)
        self.assertEqual(self.c.post("/api/v1/auth/resend-verification", json={"email": "nadie@x.co"}).status_code, 200)
        self.assertEqual(self.mail.send_verification_code.call_count, 2, "no manda correo si no hay registro pendiente")
        self.assertEqual(self.c.post("/api/v1/auth/resend-verification", json={}).status_code, 400)

    def test_verification_link_roundtrip(self):
        self.reg()
        link = self.mail.send_verification_code.call_args.kwargs["verify_link"]
        token = parse_qs(urlparse(link).query)["verify"][0]
        j = self.c.get(f"/api/v1/auth/pending-registration?token={token}").get_json()
        self.assertTrue(j["found"])
        self.assertNotIn("password", str(j).lower().replace("password_", ""))
        self.assertFalse(self.c.get("/api/v1/auth/pending-registration?token=falso").get_json()["found"])
        self.assertFalse(self.c.get("/api/v1/auth/pending-registration").get_json()["found"])

    def test_login_blocked_until_verified_and_reissues_code(self):
        u = self.make(is_verified=False)
        db.session.add(TrustedDevice(user_id=u.id, device_id="d")); db.session.commit()
        r = self.c.post("/api/v1/auth/login", json={"documento": u.id, "password": PW, "device_id": "d"})
        self.assertEqual(r.status_code, 403)
        self.assertTrue(r.get_json()["requires_verification"])


class TestNewDeviceAndTwoFactor(AccountCase):
    def login(self, u, device="nuevo"):
        return self.c.post("/api/v1/auth/login", json={"documento": u.id, "password": PW, "device_id": device})

    def approval_token(self):
        link = self.mail.send_new_device_alert.call_args.args[2]
        return parse_qs(urlparse(link).query)["token"][0]

    def test_new_device_flow_end_to_end(self):
        u = self.make()
        r = self.login(u)
        self.assertEqual(r.status_code, 200)
        j = r.get_json()
        self.assertTrue(j["requires_device_approval"])
        self.assertNotIn("access_token", j)
        self.assertNotIn("@", j["email_hint"].split("@")[0].replace("*", ""), "el correo se enmascara")
        poll = j["poll_token"]
        self.assertEqual(self.c.post("/api/v1/auth/device-approval-status", json={"poll_token": poll}).get_json()["status"], "pending")
        ok = self.c.post("/api/v1/auth/approve-device", json={"token": self.approval_token(), "device_id": "otro-aparato"})
        self.assertEqual(ok.status_code, 200, ok.get_json())
        self.assertTrue(ok.get_json()["access_token"])
        self.assertEqual(TrustedDevice.query.filter_by(user_id=u.id).count(), 2)
        done = self.c.post("/api/v1/auth/device-approval-status", json={"poll_token": poll}).get_json()
        self.assertEqual(done["status"], "approved")
        again = self.c.post("/api/v1/auth/device-approval-status", json={"poll_token": poll}).get_json()
        self.assertNotEqual(again["status"], "approved", "los tokens del sondeo se entregan una sola vez")
        self.assertEqual(self.login(u, "nuevo").get_json().get("requires_device_approval"), None)

    def test_approval_link_is_single_use_and_tamper_proof(self):
        u = self.make(); self.login(u); tok = self.approval_token()
        self.assertEqual(self.c.post("/api/v1/auth/approve-device", json={"token": tok + "x"}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/approve-device", json={"token": ""}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/approve-device", json={"token": tok}).status_code, 200)
        self.assertEqual(self.c.post("/api/v1/auth/approve-device", json={"token": tok}).status_code, 400)

    def test_new_login_invalidates_previous_link(self):
        u = self.make(); self.login(u); old = self.approval_token(); self.login(u)
        self.assertEqual(self.c.post("/api/v1/auth/approve-device", json={"token": old}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/approve-device", json={"token": self.approval_token()}).status_code, 200)

    def test_blocked_user_cannot_use_an_approval_link(self):
        u = self.make(); self.login(u); tok = self.approval_token()
        u.is_blocked = True; db.session.commit()
        self.assertEqual(self.c.post("/api/v1/auth/approve-device", json={"token": tok}).status_code, 403)

    def test_email_failure_does_not_lock_the_user_out(self):
        self.mail.send_new_device_alert.return_value = False
        u = self.make(); r = self.login(u)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json().get("access_token"), "si el correo no sale, se permite el acceso")

    def temp_headers(self, u):
        from flask_jwt_extended import create_access_token
        t = create_access_token(identity=str(u.id), additional_claims={"type": "2fa_temp"}, expires_delta=timedelta(minutes=10))
        return {"Authorization": f"Bearer {t}"}

    def test_verify_2fa_requires_the_temp_token(self):
        u = self.make(totp_secret=pyotp.random_base32(), is_2fa_enabled=True)
        code = pyotp.TOTP(u.totp_secret).now()
        r = self.c.post("/api/v1/auth/verify-2fa", headers=self.H(u), json={"code": code})
        self.assertEqual(r.status_code, 401, "un token normal no debe servir para completar el 2FA")
        r = self.c.post("/api/v1/auth/verify-2fa", headers=self.temp_headers(u), json={"code": code, "device_id": "d9"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertTrue(r.get_json()["access_token"])
        self.assertEqual(self.c.post("/api/v1/auth/verify-2fa", headers=self.temp_headers(u), json={}).status_code, 400)

    def test_temp_token_is_not_a_session(self):
        u = self.make()
        self.assertIn(self.c.get("/api/v1/users_mgmt/me", headers=self.temp_headers(u)).status_code, (401, 403, 422),
                      "el token temporal de 2FA no debe abrir rutas normales")

    def test_email_2fa_code_flow_and_antispam(self):
        u = self.make(); h = self.temp_headers(u)
        self.assertEqual(self.c.post("/api/v1/auth/2fa/send-email", headers=h).status_code, 200)
        self.assertEqual(self.c.post("/api/v1/auth/2fa/send-email", headers=h).status_code, 429)
        code = self.mail.send_2fa_code.call_args.args[1]
        self.assertEqual(self.c.post("/api/v1/auth/verify-2fa", headers=h, json={"code": "000000"}).status_code, 401)
        self.assertEqual(self.c.post("/api/v1/auth/verify-2fa", headers=h, json={"code": code}).status_code, 200)
        self.assertEqual(self.c.post("/api/v1/auth/verify-2fa", headers=h, json={"code": code}).status_code, 401, "el código se usa una sola vez")

    def test_totp_guessing_is_limited(self):
        """Sin límite, alguien con el token temporal puede probar los 1.000.000 de códigos TOTP."""
        u = self.make(totp_secret=pyotp.random_base32(), is_2fa_enabled=True); h = self.temp_headers(u)
        good = pyotp.TOTP(u.totp_secret).now()
        wrong = "000000" if good != "000000" else "111111"
        for _ in range(12):
            self.c.post("/api/v1/auth/verify-2fa", headers=h, json={"code": wrong})
        r = self.c.post("/api/v1/auth/verify-2fa", headers=h, json={"code": good})
        self.assertNotEqual(r.status_code, 200, "tras 12 intentos fallidos el código correcto no debería aceptarse")

    def test_generate_authenticator(self):
        u = self.make()
        j = self.c.post("/api/v1/auth/2fa/authenticator/generate", headers=self.H(u)).get_json()
        self.assertTrue(j["otpauth_url"].startswith("otpauth://totp/"))
        self.assertTrue(pyotp.TOTP(j["totp_secret"]).verify(pyotp.TOTP(j["totp_secret"]).now()))
        self.assertEqual(User.query.get(u.id).totp_secret, j["totp_secret"])


class TestPasswordFlows(AccountCase):
    def test_forgot_password_sends_temp_password_and_forces_change(self):
        u = self.make(); db.session.add(TrustedDevice(user_id=u.id, device_id="d")); db.session.commit()
        self.c.post("/api/v1/auth/login", json={"documento": u.id, "password": PW, "device_id": "d"})
        r = self.c.post("/api/v1/auth/forgot-password", json={"email": u.email})
        self.assertEqual(r.status_code, 200)
        temp = self.mail.send_temporary_password.call_args.args[1]
        self.assertGreaterEqual(len(temp), 12)
        row = User.query.get(u.id)
        self.assertTrue(row.must_change_password)
        self.assertTrue(bcrypt.checkpw(temp.encode(), row.password.encode()))
        self.assertEqual(RefreshToken.query.filter_by(user_id=u.id, is_revoked=False).count(), 0, "todas las sesiones se cierran")
        ok = self.c.post("/api/v1/auth/login", json={"documento": u.id, "password": temp, "device_id": "d"})
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.get_json()["must_change_password"])
        h = {"Authorization": "Bearer " + ok.get_json()["access_token"]}
        self.assertEqual(self.c.post("/api/v1/auth/force-change-password", headers=h, json={"new_password": temp}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/force-change-password", headers=h, json={"new_password": "corta"}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/force-change-password", headers=h, json={"new_password": "NuevaClave99"}).status_code, 200)
        self.assertFalse(User.query.get(u.id).must_change_password)
        self.assertEqual(self.c.post("/api/v1/auth/login", json={"documento": u.id, "password": "NuevaClave99", "device_id": "d"}).status_code, 200)

    def test_forgot_password_unlocks_blocked_account(self):
        u = self.make(is_blocked=True, failed_attempts=5)
        self.c.post("/api/v1/auth/forgot-password", json={"email": u.email})
        row = User.query.get(u.id); self.assertFalse(row.is_blocked); self.assertEqual(row.failed_attempts, 0)

    def test_forgot_password_does_not_change_anything_if_email_fails(self):
        self.mail.send_temporary_password.return_value = False
        u = self.make(); before = u.password
        self.c.post("/api/v1/auth/forgot-password", json={"email": u.email})
        self.assertEqual(User.query.get(u.id).password, before)
        self.assertFalse(User.query.get(u.id).must_change_password)

    def test_forgot_password_neutral_for_unknown_bad_and_deleted(self):
        u = self.make(is_deleted=True)
        codes = {self.c.post("/api/v1/auth/forgot-password", json={"email": e}).status_code
                 for e in ("nadie@x.co", "no-es-correo", u.email)}
        self.assertEqual(codes, {200})
        self.mail.send_temporary_password.assert_not_called()

    def test_two_step_password_change(self):
        u = self.make(); h = self.H(u)
        bad = self.c.post("/api/v1/auth/request-password-change", headers=h, json={"old_password": "mala", "new_password": "NuevaClave99"})
        self.assertEqual(bad.status_code, 401)
        self.assertEqual(self.c.post("/api/v1/auth/request-password-change", headers=h, json={"old_password": PW, "new_password": PW}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/request-password-change", headers=h, json={"old_password": PW, "new_password": "corta"}).status_code, 400)
        ok = self.c.post("/api/v1/auth/request-password-change", headers=h, json={"old_password": PW, "new_password": "NuevaClave99"})
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(bcrypt.checkpw(PW.encode(), User.query.get(u.id).password.encode()), "aún no cambia hasta confirmar")
        code = self.mail.send_password_change_code.call_args.args[1]
        self.assertEqual(self.c.post("/api/v1/auth/confirm-password-change", headers=h, json={"code": "000000"}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/confirm-password-change", headers=h, json={"code": code}).status_code, 200)
        self.assertTrue(bcrypt.checkpw(b"NuevaClave99", User.query.get(u.id).password.encode()))
        self.assertEqual(self.c.post("/api/v1/auth/confirm-password-change", headers=h, json={"code": code}).status_code, 400, "el código no se reutiliza")

    def test_password_change_code_locks_after_too_many_attempts(self):
        u = self.make(); h = self.H(u)
        self.c.post("/api/v1/auth/request-password-change", headers=h, json={"old_password": PW, "new_password": "NuevaClave99"})
        code = self.mail.send_password_change_code.call_args.args[1]
        for _ in range(6):
            self.c.post("/api/v1/auth/confirm-password-change", headers=h, json={"code": "000000" if code != "000000" else "111111"})
        self.assertEqual(self.c.post("/api/v1/auth/confirm-password-change", headers=h, json={"code": code}).status_code, 400)
        self.assertTrue(bcrypt.checkpw(PW.encode(), User.query.get(u.id).password.encode()))

    def test_code_for_one_user_does_not_work_for_another(self):
        a, b = self.make(), self.make()
        self.c.post("/api/v1/auth/request-password-change", headers=self.H(a), json={"old_password": PW, "new_password": "NuevaClave99"})
        code = self.mail.send_password_change_code.call_args.args[1]
        self.assertEqual(self.c.post("/api/v1/auth/confirm-password-change", headers=self.H(b), json={"code": code}).status_code, 400)

    def test_legacy_reset_token_flow(self):
        from app.services.token_service import TokenService
        u = self.make(must_change_password=True)
        tok = TokenService.create_password_reset_token(u)
        self.assertEqual(self.c.post("/api/v1/auth/reset-password", json={"token": tok, "new_password": "corta"}).status_code, 400)
        self.assertEqual(self.c.post("/api/v1/auth/reset-password", json={"token": tok, "new_password": "NuevaClave99"}).status_code, 200)
        self.assertEqual(self.c.post("/api/v1/auth/reset-password", json={"token": tok, "new_password": "OtraClave99"}).status_code, 400, "el token es de un solo uso")

    def test_expired_reset_token(self):
        from app.services.token_service import TokenService
        from app.models import PasswordResetToken
        u = self.make(); tok = TokenService.create_password_reset_token(u)
        row = PasswordResetToken.query.first(); row.expires_at = datetime.utcnow() - timedelta(seconds=1); db.session.commit()
        self.assertEqual(self.c.post("/api/v1/auth/reset-password", json={"token": tok, "new_password": "NuevaClave99"}).status_code, 400)

    def test_trusted_devices_management_is_private(self):
        a, b = self.make(), self.make()
        db.session.add_all([TrustedDevice(user_id=a.id, device_id="da", label="PC de A"), TrustedDevice(user_id=b.id, device_id="db", label="PC de B")]); db.session.commit()
        lst = self.c.get("/api/v1/auth/trusted-devices", headers=self.H(a)).get_json()
        self.assertEqual([d["label"] for d in lst], ["PC de A"])
        b_row = TrustedDevice.query.filter_by(user_id=b.id).first()
        r = self.c.delete(f"/api/v1/auth/trusted-devices/{b_row.id}", headers=self.H(a))
        self.assertIn(r.status_code, (403, 404))
        self.assertEqual(TrustedDevice.query.filter_by(user_id=b.id).count(), 1)
        self.c.delete("/api/v1/auth/trusted-devices", headers=self.H(a), json={})
        self.assertEqual(TrustedDevice.query.filter_by(user_id=a.id).count(), 0)
        self.assertEqual(TrustedDevice.query.filter_by(user_id=b.id).count(), 1)


class TestEmailChange(AccountCase):
    def test_email_change_needs_password_and_valid_new_email(self):
        u = self.make(); h = self.H(u)
        self.assertEqual(self.c.post("/api/v1/auth/change-email", headers=h, json={"new_email": "n@t.com"}).status_code, 400)
        r = self.c.post("/api/v1/auth/change-email", headers=h, json={"new_email": "n@t.com", "password": "mala"})
        self.assertIn(r.status_code, (400, 401, 403))
        r = self.c.post("/api/v1/auth/change-email", headers=h, json={"new_email": "no-es-correo", "password": PW})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(User.query.get(u.id).email, u.email)

    def test_cannot_take_an_email_that_belongs_to_someone_else(self):
        a, b = self.make(), self.make()
        r = self.c.post("/api/v1/auth/change-email", headers=self.H(a), json={"new_email": b.email, "password": PW})
        self.assertIn(r.status_code, (400, 409))
        self.assertEqual(User.query.get(a.id).email, a.email)

    def test_verify_email_change_rejects_bad_code(self):
        u = self.make()
        r = self.c.post("/api/v1/auth/verify-email-change", headers=self.H(u), json={"code": "123456"})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
