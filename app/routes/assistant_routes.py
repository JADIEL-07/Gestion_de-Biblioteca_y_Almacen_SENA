import os
import json
import requests
import string
import time
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from ..models.item import Item
from ..models.loan import Loan
from ..models.user import User
from ..models.ai_knowledge import AILearnedResponse
from ..models.assistant_thread import AssistantThread
from .. import db

assistant_bp = Blueprint('assistant', __name__)

# Roles que pueden escalar conversaciones al equipo de Soporte desde el asistente.
# INVITADO no aparece aquí porque no tiene sesión: el frontend le pide iniciar sesión primero.
ESCALATABLE_ROLES = {'APRENDIZ', 'USUARIO', 'ALMACENISTA', 'BIBLIOTECARIO'}


def get_query_keywords(text):
    stopwords = {'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'de', 'para', 'en', 'por', 'a', 'con', 'que', 'qué', 'como', 'cómo', 'cual', 'cuál', 'te', 'me', 'se', 'lo', 'al', 'del'}
    words = text.lower().translate(str.maketrans('', '', string.punctuation)).split()
    return " ".join([w for w in words if w not in stopwords and len(w) > 2])

@assistant_bp.route('/chat', methods=['POST'])
@jwt_required(optional=True)
def chat_ai():
    data = request.get_json() or {}
    user_query = data.get('message', '').strip()
    history = data.get('history', [])
    media = data.get('media')
    
    if not user_query:
        return jsonify({"error": "El mensaje no puede estar vacío"}), 400
        
    # --- SISTEMA DE CACHÉ BÁSICO ---
    # Solo cacheamos si no hay archivos adjuntos
    from flask import current_app
    import time
    
    cache_key = None
    if not media:
        cache_store = current_app.config.setdefault('BOT_CACHE', {})
        # Clave basada en la pregunta y cantidad de mensajes previos
        cache_key = f"cache_{user_query.strip().lower()}_{len(history)}"
        
        if cache_key in cache_store:
            cached_data, timestamp = cache_store[cache_key]
            if time.time() - timestamp < 300:  # 5 minutos de vigencia
                print(f"Sirviendo respuesta desde CACHÉ: {cache_key}")
                return jsonify(cached_data)
    # -------------------------------
        
    # 1. Obtener la identidad del usuario actual
    user_id = get_jwt_identity()
    user = None
    if user_id:
        user = User.query.filter_by(id=str(user_id)).first()
        
    user_name = user.name if user else 'Invitado'

    # 1.b Obtener rol del usuario para personalizar instrucciones
    user_role = 'INVITADO'
    if user and user.role:
        user_role = (user.role.name or '').upper().strip() or 'USUARIO'

    # Capacidades por rol — la IA usará esto para guiar al usuario
    ROLE_CAPABILITIES = {
        'ADMIN': """ROL ACTUAL: ADMINISTRADOR (control total del sistema).
CAPACIDADES Y MENÚ DISPONIBLE:
- Gestión de Usuarios: crear, editar, cambiar rol, desactivar cuentas. Ubicación: menú lateral → "Usuarios". Botón "Nuevo usuario" arriba a la derecha.
- Gestión de Inventario: agregar/editar libros, herramientas, equipos. Crear categorías, ubicaciones. Menú → "Inventario".
- Préstamos: ver, crear y devolver préstamos de cualquier usuario. Menú → "Préstamos".
- Reservas: gestionar todas las reservas activas. Menú → "Reservas".
- Mantenimiento: revisar incidencias de elementos dañados. Menú → "Mantenimiento".
- Salidas controladas: autorizar salidas de equipos. Menú → "Salidas".
- Reportes estadísticos: ver gráficos y métricas. Menú → "Reportes".
- Auditoría: ver historial completo de acciones en el sistema. Menú → "Auditoría".
- Solicitudes: ver tickets escalados (pero solo Soporte puede aceptarlos).
- Configuración del sistema: parámetros globales. Menú → "Configuración".
PUEDES indicar al admin cómo realizar cualquier operación administrativa paso a paso. Eres su asistente con acceso total a la guía del sistema.""",

        'SOPORTE': """ROL ACTUAL: SOPORTE TÉCNICO.
CAPACIDADES Y MENÚ DISPONIBLE:
- Solicitudes: ver bandeja de tickets escalados por aprendices, aceptarlos y atenderlos por chat. Menú → "Solicitudes".
- Mantenimiento: registrar y resolver incidencias de equipos dañados. Menú → "Mantenimiento".
- Repuestos: gestionar solicitudes de repuestos.
- Chat interno: comunicación con Bibliotecario, Almacenista y Admin.
NO tienes acceso a: gestión de usuarios, inventario general, reportes ejecutivos.
Guía a Soporte a usar sus herramientas. No le sugieras tareas de admin.""",

        'BIBLIOTECARIO': """ROL ACTUAL: BIBLIOTECARIO.
CAPACIDADES Y MENÚ DISPONIBLE:
- Gestión de libros: agregar, editar, ver disponibilidad. Menú → "Libros".
- Préstamos de libros: registrar entregas y devoluciones. Menú → "Préstamos".
- Reservas de libros: gestionar apartados de la biblioteca.
- Chat interno con otros funcionarios.
NO tienes acceso a: gestión de usuarios, herramientas/equipos del almacén, reportes administrativos.
Guía al bibliotecario en sus tareas específicas de biblioteca.""",

        'ALMACENISTA': """ROL ACTUAL: ALMACENISTA.
CAPACIDADES Y MENÚ DISPONIBLE:
- Gestión de herramientas y equipos del almacén: agregar, editar, ver stock. Menú → "Almacén".
- Préstamos de equipos: registrar entregas y devoluciones de herramientas.
- Reservas de equipos: gestionar apartados.
- Salidas controladas: registrar salidas autorizadas de equipos.
- Chat interno con otros funcionarios.
NO tienes acceso a: gestión de usuarios, libros, reportes administrativos.
Guía al almacenista en sus tareas específicas del almacén.""",

        'INSTRUCTOR': """ROL ACTUAL: INSTRUCTOR.
CAPACIDADES Y MENÚ DISPONIBLE:
- Explorar el catálogo y solicitar préstamos de libros y equipos.
- Ver sus préstamos activos y reservas.
- Autorizar préstamos de herramientas pesadas a sus aprendices (firma).
NO tienes acceso a: gestión de usuarios, modificar inventario, reportes administrativos, eliminar cuentas.
Guía al instructor en consultas y solicitudes.""",

        'APRENDIZ': """ROL ACTUAL: APRENDIZ.
CAPACIDADES Y MENÚ DISPONIBLE:
- Explorar el catálogo: libros y herramientas disponibles.
- Reservar elementos (15 minutos para retirar).
- Ver sus préstamos activos y fechas de devolución.
- Ver sus reservas pendientes.
- Ver su historial de movimientos.
- Asistente personal (este chat).
- Configurar su perfil.
- Escalar conversaciones al equipo de Soporte si la IA no resuelve.
NO tienes acceso a: gestión de usuarios, modificar inventario, ver préstamos de otros, reportes administrativos, eliminar usuarios, auditoría.
IMPORTANTE: Si el aprendiz pide algo fuera de sus permisos (eliminar usuario, modificar inventario, ver préstamos de terceros, acceder a reportes administrativos), explícale amablemente que esas acciones son exclusivas del personal autorizado y NO le sugieras formas de saltarse la restricción.""",

        'USUARIO': """ROL ACTUAL: USUARIO (similar a Aprendiz).
CAPACIDADES Y MENÚ DISPONIBLE:
- Explorar el catálogo.
- Reservar elementos.
- Ver sus préstamos y reservas.
- Asistente personal.
- Configurar su perfil.
NO tienes acceso a: gestión administrativa de ningún tipo.
Si pide acciones administrativas, indica que necesita un rol con esos permisos.""",

        'PROVEEDOR': """ROL ACTUAL: PROVEEDOR.
CAPACIDADES: ver órdenes de suministro y entregas pendientes.
Guía al proveedor en su flujo específico.""",

        'INVITADO': """ROL ACTUAL: INVITADO (sin sesión iniciada).
CAPACIDADES LIMITADAS:
- Solo puede explorar el catálogo en modo lectura.
- No puede reservar, prestar, ni ver datos personales.
- Para hacer cualquier acción debe iniciar sesión o registrarse.
Sugiérele iniciar sesión cuando pida algo restringido.""",
    }
    role_caps = ROLE_CAPABILITIES.get(user_role, ROLE_CAPABILITIES['USUARIO'])

    # 2. RAG: Obtener información de Préstamos Activos
    user_loans_text = "No tienes préstamos activos actualmente."
    active_loans_list = []
    if user:
        loans = Loan.query.filter_by(user_id=str(user.id)).filter(Loan.status.in_(['ACTIVE', 'OVERDUE'])).all()
        if loans:
            user_loans_text = "Tienes los siguientes préstamos activos en el sistema:\n"
            for l in loans:
                for detail in l.details:
                    due_str = l.due_date.strftime('%Y-%m-%d %H:%M') if l.due_date else 'N/A'
                    user_loans_text += f"- Elemento: {detail.item.name} | Código: {detail.item.code} | Entregar antes de: {due_str} | Estado: {l.status}\n"
                    active_loans_list.append({
                        "id": detail.item.id,
                        "name": detail.item.name,
                        "code": detail.item.code,
                        "due_date": due_str,
                        "status": l.status
                    })

    # 3. RAG: Obtener catálogo de elementos relevantes según la pregunta
    inventory_context = ""
    keywords = [w.lower() for w in user_query.split() if len(w) > 3]
    relevant_items = []
    
    # Buscar elementos que coincidan por nombre o descripción
    if keywords:
        all_items = Item.query.all()
        for item in all_items:
            item_name_lower = item.name.lower() if item.name else ''
            item_desc_lower = item.description.lower() if item.description else ''
            if any(k in item_name_lower or k in item_desc_lower for k in keywords):
                relevant_items.append(item)
                
    # Si no hay coincidencias directas, jalar los 15 primeros elementos del catálogo como contexto básico
    if not relevant_items:
        relevant_items = Item.query.limit(15).all()
        
    if relevant_items:
        inventory_context = "A continuación, se listan los elementos relevantes que coinciden con tu inventario:\n"
        for item in relevant_items:
            cat_name = item.category.name if item.category else 'General'
            status_name = item.status_obj.name if item.status_obj else 'AVAILABLE'
            inventory_context += f"- {item.name} (Categoría: {cat_name}) | Código/ISBN: {item.code} | Stock: {item.stock} | Estado: {status_name}\n"
    else:
        inventory_context = "No se encontraron elementos disponibles en el catálogo en este momento."

    # 4. Construir System Instructions
    system_instruction = f"""
Eres SENA Bot, el asistente virtual inteligente oficial de la Biblioteca y Almacén del Centro de Formación SENA Sede Vélez, Santander.

DESCRIPCIÓN GLOBAL DEL SISTEMA Y CONTEXTO:
Eres la inteligencia artificial integrada en un sistema web moderno para la gestión de inventario, biblioteca y control de activos del SENA. Este sistema soluciona problemas previos de desorganización y falta de trazabilidad.
- Funcionalidades clave: Inventario inteligente (identificación única QR/Código), control preciso de estados y ubicaciones, reservas en tiempo real (que se liberan tras un tiempo límite), sistema avanzado de préstamos con historial y penalizaciones, notificaciones, módulo de mantenimiento para daños, y control de salidas de la sede.
- Seguridad y Trazabilidad: Autenticación por roles (JWT), historial completo de movimientos (auditoría), y paneles administrativos estadísticos para toma de decisiones.
- Roles en el sistema: Aprendiz e Instructor (consultan y piden préstamos), Bibliotecario (libros), Almacenista (herramientas/equipos), Soporte técnico (reparaciones), Administrador (control total) y Proveedor.

GUÍA DE NAVEGACIÓN DE LA PLATAFORMA (Menú Lateral):
- "Inicio": Resumen general del sistema.
- "Explorar elementos": Catálogo completo para buscar y reservar libros, herramientas y equipos.
- "Mis préstamos": Ver los elementos que tienes actualmente y sus fechas de devolución.
- "Mis reservas": Ver los elementos apartados pendientes por recoger.
- "Historial": Registro de todos tus movimientos pasados.
- "Asistente personal": Este chat donde estamos hablando.
- "Notificaciones": Alertas sobre retrasos, confirmaciones, etc.
- "Configuración": Contiene un panel avanzado con las siguientes pestañas:
  * "Información personal" (editar nombres, documento, foto de perfil, biografía).
  * "Correo electrónico" (cambiar y verificar correo).
  * "Cambiar contraseña".
  * "Autenticación en dos pasos" (configurar 2FA con App o SMS).
  * "Sesiones activas" (ver IPs y cerrar sesiones remotas).
  * "Preferencias de notificaciones" y "Alertas y recordatorios" (modo silencio).
  * "Privacidad y datos" (descargar datos en JSON).
  * "Historial de accesos" (registro de inicios de sesión y bloqueos).
  * "Eliminar cuenta" (opción para borrar cuenta permanentemente escribiendo una frase de confirmación).
- "Perfil": Haciendo clic en el ícono del lápiz sobre tu avatar (abajo a la izquierda) accedes a Configuración rápida.

INFORMACIÓN EN TIEMPO REAL DEL USUARIO (RAG):
- Nombre del Usuario: {user_name}
- Estado de autenticación: {'Iniciado sesión' if user else 'Invitado'}
- Rol del usuario: {user_role}
- Préstamos activos del usuario:
  {user_loans_text}

═══════════════════════════════════════════════
CAPACIDADES Y PERMISOS DEL ROL ACTUAL
═══════════════════════════════════════════════
{role_caps}
═══════════════════════════════════════════════

INFORMACIÓN EN TIEMPO REAL DEL CATÁLOGO DE INVENTARIO (RAG):
{inventory_context}

POLÍTICAS Y NORMAS DEL SENA:
- Horarios de atención: Lunes a Viernes de 6:00 AM a 10:00 PM. Sábados, domingos y festivos cerrado.
- Reglamento de Libros: Préstamo de libros de biblioteca estándar de 8 días calendario, renovable. Debes presentarte con tu carnet físico o cédula. Si reservas, tienes hasta 15 minutos para retirar el elemento en ventanilla.
- Reglamento de Almacén de Herramientas/Equipos: Préstamo estándar por 3 días hábiles. Se requiere presentar tu documento y carnet, y para herramientas pesadas se requiere firma de autorización de tu instructor de taller.
- Sanciones por demoras: Suspensión de préstamo por 1 día por cada día de retraso de cada elemento.
- Pérdida o daños: Plazo máximo de 15 días hábiles para reponer el artículo por uno exactamente igual (marca y modelo) o superior. Mientras tanto, la cuenta de préstamos queda bloqueada.
- Ubicación de la Sede Vélez:
  * Biblioteca: Bloque Principal, primer piso junto al área administrativa.
  * Almacén de Equipos: Al fondo del pasillo técnico, contiguo a los talleres de electricidad y automatización.

INSTRUCCIONES DE RESPUESTA:
1. Responde siempre en español, con un tono motivador, empático, amigable, claro y sumamente profesional (como un consejero tecnológico del SENA).
2. Utiliza negritas, listas ordenadas/desordenadas y emojis para que tus respuestas se vean hermosas y organizadas.
3. Responde de forma natural. Puedes saludar libremente según el contexto de la conversación.
4. CRÍTICO — RESPETA EL ROL: Antes de responder cualquier pregunta sobre acciones del sistema (crear/editar/eliminar usuarios, modificar inventario, ver reportes, etc.), REVISA las CAPACIDADES Y PERMISOS DEL ROL ACTUAL arriba.
   - Si la acción ESTÁ permitida para este rol: guía paso a paso (dónde está en el menú, qué botón presionar, qué campos llenar). Eres un asistente con acceso total a esa función.
   - Si la acción NO está permitida para este rol: explícalo amablemente y sugiere a quién pedírselo o si necesita escalar a soporte. NUNCA expliques cómo saltarse la restricción.
   - EJEMPLO: si un ADMIN pregunta "cómo agrego un usuario", debes explicarle exactamente que vaya a Menú → Usuarios → botón "Nuevo usuario". NO le digas "no tengo permisos" — ese rol SÍ puede hacerlo.
   - EJEMPLO: si un APRENDIZ pregunta "cómo elimino a otro usuario", debes responder que esa acción está reservada al administrador del sistema.
5. Si el usuario te pregunta sobre la disponibilidad de un artículo, revisa la "INFORMACIÓN EN TIEMPO REAL DEL CATÁLOGO" y responde con exactitud (stock, código).
6. Si el usuario pregunta por sus préstamos, revisa la sección de préstamos arriba.
7. Mantén tus respuestas concisas pero completas. No inventes elementos del catálogo.
8. Si la consulta es completamente fuera del sistema SENA (matemáticas, vida personal, otros temas), termina tu respuesta con la línea exacta: [ESCALAR_SOPORTE]
"""

    # Si es una conversación nueva (historial vacío), pedir que genere título
    valid_history_messages = [m for m in history if m.get("role") == "user"]
    if len(valid_history_messages) == 0:
        system_instruction += "\n\nREGLA ADICIONAL: Como este es el primer mensaje de la conversación, DEBES iniciar tu respuesta exactamente con la palabra 'TITULO: ' seguida de un breve resumen de máximo 4 a 5 palabras del tema consultado, luego haz un salto de línea y continúa con tu respuesta normal."

    q_lower = user_query.lower()

    # 4.4 INTENCIÓN EXPLÍCITA: el usuario pide hablar con soporte/humano
    # Detectamos esto ANTES de llamar a la IA propia o Gemini — no tiene sentido
    # gastar tokens si lo que quiere es escalar.
    SUPPORT_REQUEST_KEYWORDS = [
        'quiero soporte', 'quiero hablar con soporte', 'contactar soporte',
        'contactar a soporte', 'hablar con soporte', 'necesito soporte',
        'solicitar soporte', 'solicitar a un soporte', 'solicitar un soporte',
        'hablar con un humano', 'hablar con una persona', 'necesito ayuda humana',
        'atención humana', 'atencion humana', 'crear ticket', 'abrir ticket',
        'reportar problema', 'reportar un problema'
    ]
    if any(k in q_lower for k in SUPPORT_REQUEST_KEYWORDS):
        role_up = ''
        if user and user.role:
            role_up = (user.role.name or '').upper().strip()
        can_escalate_now = role_up in ESCALATABLE_ROLES

        if can_escalate_now:
            return jsonify({
                "text": "Entendido. Puedo crear una solicitud al equipo de Soporte para que te atiendan en este mismo chat.",
                "type": "text",
                "suggest_support": True,
                "source": "intent-support",
            })
        elif not user:
            return jsonify({
                "text": "Para contactar al equipo de Soporte necesitas iniciar sesión primero. Una vez dentro, vuelve a pedírmelo y te crearé la solicitud.",
                "type": "text",
                "source": "intent-support-guest",
            })
        elif 'SOPORTE' in role_up:
            return jsonify({
                "text": f"Hola **{user_name}**, ¡tú eres parte del equipo de Soporte! 😊 No tiene sentido que escales un ticket a ti mismo. Si necesitas atender solicitudes pendientes, ve al menú lateral → **Solicitudes**. Si necesitas hablar con un Administrador, contáctalo por el chat interno de staff.",
                "type": "text",
                "source": "intent-support-isstaff",
            })
        elif role_up == 'ADMIN':
            return jsonify({
                "text": f"Hola **{user_name}**, como **Administrador** tienes acceso total al sistema. No requieres escalar tickets a Soporte. Si necesitas revisar tickets activos, ve a **Solicitudes** en el menú lateral.",
                "type": "text",
                "source": "intent-support-isadmin",
            })
        else:
            return jsonify({
                "text": f"Tu rol (**{role_up.capitalize()}**) no tiene habilitada la escalación a Soporte desde este chat. Para asistencia, dirígete al área correspondiente del SENA.",
                "type": "text",
                "source": "intent-support-norole",
            })

    # 4.5 PRIORIDAD: consultar primero la IA propia (AILearnedResponse).
    # SOLO si es el PRIMER mensaje (sin historial) y no hay multimedia ni RAG dinámico.
    # Razón: los mensajes de seguimiento ("es de manera educativa", "sí", "no", etc.)
    # solo tienen sentido en el contexto de la conversación previa, y la IA propia
    # busca por keywords sin contexto — devolvería respuestas absurdas.
    RAG_TRIGGERS = ['mis prestamos', 'mis préstamos', 'mi prestamo', 'mi préstamo',
                    'cuanto debo', 'cuánto debo', 'tengo prestamo', 'tengo préstamo',
                    'stock', 'disponible', 'disponibilidad', 'cuantos hay', 'cuántos hay',
                    'tengo multa', 'tengo sancion', 'tengo sanción']
    needs_fresh_data = any(t in q_lower for t in RAG_TRIGGERS)
    has_conversation_history = len([m for m in history if m.get("role") == "user"]) > 0

    if not media and not needs_fresh_data and not has_conversation_history:
        try:
            # Caso especial: saludos → buscar el saludo guardado de Gemini
            GREETING_KEYWORDS = ['hola', 'saludos', 'buenos dias', 'buenas tardes',
                                 'buen dia', 'buena tarde', 'quien eres', 'quién eres']
            is_greeting = any(k in q_lower for k in GREETING_KEYWORDS) and len(user_query) < 40
            if is_greeting:
                saved = AILearnedResponse.query.filter_by(query_keywords='saludo bienvenida inicial').first()
                if saved:
                    saved.use_count += 1
                    db.session.commit()
                    print(f"[IA-PROPIA] Saludo servido desde BD (uso #{saved.use_count})")
                    return jsonify({"text": saved.response_text, "type": "text", "source": "own-ai-greeting"})

            # Búsqueda general por keywords
            user_kws = get_query_keywords(user_query)
            if len(user_kws) > 5:
                words = user_kws.split()
                if words:
                    search_filter = AILearnedResponse.query_keywords.ilike(f"%{words[0]}%")
                    for w in words[1:]:
                        search_filter = db.and_(search_filter, AILearnedResponse.query_keywords.ilike(f"%{w}%"))
                    learned = AILearnedResponse.query.filter(search_filter).order_by(AILearnedResponse.use_count.desc()).first()
                    if learned:
                        learned.use_count += 1
                        db.session.commit()
                        print(f"[IA-PROPIA] Respuesta servida desde BD (uso #{learned.use_count})")
                        return jsonify({
                            "text": learned.response_text,
                            "type": "text",
                            "source": "own-ai",
                        })
        except Exception as e:
            print(f"[IA-PROPIA] Error buscando en BD: {e}")
            db.session.rollback()

    # 5. Intentar llamar a Gemini API de Google usando REST API
    # Cadena de modelos: intenta el primero, si da 429 (cuota agotada) cae al siguiente.
    api_key = os.environ.get('GEMINI_API_KEY')
    GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']

    if not api_key:
        print("[GEMINI] GEMINI_API_KEY no configurada en el entorno — usando fallback rule-based")

    if api_key:
        # Construir contents una sola vez (compartido entre intentos)
        contents = []
        for msg in history[-10:]:
            role = "user" if msg.get("role") == "user" else "model"
            if "¡Hola" in msg.get("text", "") and role == "model":
                continue
            if contents and contents[-1]["role"] == role:
                contents[-1]["parts"][0]["text"] += "\n" + msg.get("text", "")
            else:
                contents.append({"role": role, "parts": [{"text": msg.get("text", "")}]})

        user_parts = [{"text": user_query}]
        if media and media.get("data") and media.get("mimeType"):
            user_parts.append({
                "inline_data": {
                    "mime_type": media.get("mimeType"),
                    "data": media.get("data")
                }
            })

        if contents and contents[-1]["role"] == "user":
            contents[-1]["parts"].extend(user_parts)
        else:
            contents.append({"role": "user", "parts": user_parts})

        payload = {
            "system_instruction": {"parts": [{"text": system_instruction}]},
            "contents": contents
        }
        headers = {"Content-Type": "application/json"}

        last_error = None
        for model in GEMINI_MODELS:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                response = requests.post(url, json=payload, headers=headers, timeout=20)

                if response.status_code == 200:
                    res_data = response.json()
                    bot_text = res_data['candidates'][0]['content']['parts'][0]['text']
                    print(f"[GEMINI OK] modelo={model}")

                    title = None
                    if bot_text.startswith("TITULO:"):
                        parts_text = bot_text.split('\n', 1)
                        title = parts_text[0].replace("TITULO:", "").strip()
                        bot_text = parts_text[1].strip() if len(parts_text) > 1 else bot_text

                    # Detectar si Gemini indica que no puede ayudar
                    gemini_suggest_support = False
                    if '[ESCALAR_SOPORTE]' in bot_text:
                        bot_text = bot_text.replace('[ESCALAR_SOPORTE]', '').strip()
                        if user and user.role:
                            role_up = (user.role.name or '').upper().strip()
                            gemini_suggest_support = role_up in ESCALATABLE_ROLES

                    json_response = {
                        "text": bot_text,
                        "type": "text",
                        "title": title,
                        "metadata": active_loans_list if active_loans_list else None,
                        "source": "gemini",
                        "model": model,
                        "suggest_support": gemini_suggest_support,
                    }

                    if cache_key:
                        cache_store[cache_key] = (json_response, time.time())

                    # APRENDER: guardar la respuesta de Gemini para el modo offline futuro
                    try:
                        kws = get_query_keywords(user_query)
                        # Detectar saludos PUROS (corto y solo contiene palabras de saludo)
                        # — debe coincidir con la lógica de búsqueda en el paso 4.5
                        GREETING_KEYWORDS = ['hola', 'saludos', 'buenos dias', 'buenas tardes',
                                             'buen dia', 'buena tarde', 'quien eres', 'quién eres']
                        is_pure_greeting = (
                            any(k in user_query.lower() for k in GREETING_KEYWORDS)
                            and len(user_query) < 40
                        )
                        save_kws = 'saludo bienvenida inicial' if is_pure_greeting else kws
                        if len(bot_text) > 15 and (is_pure_greeting or len(kws) > 5):
                            existing = AILearnedResponse.query.filter_by(query_keywords=save_kws).first()
                            if existing:
                                existing.response_text = bot_text
                                existing.use_count += 1
                            else:
                                db.session.add(AILearnedResponse(
                                    query_text=user_query,
                                    query_keywords=save_kws,
                                    response_text=bot_text
                                ))
                            db.session.commit()
                    except Exception as db_e:
                        db.session.rollback()
                        print("Error guardando conocimiento IA:", db_e)

                    return jsonify(json_response)

                elif response.status_code == 429:
                    print(f"[GEMINI 429] cuota agotada en {model}, probando siguiente modelo...")
                    last_error = f"429 en {model}"
                    continue
                else:
                    print(f"[GEMINI ERROR] modelo={model} status={response.status_code} body={response.text[:300]}")
                    last_error = f"{response.status_code} en {model}"
                    break  # error no recuperable, no probar mas modelos
            except Exception as e:
                print(f"[GEMINI EXC] modelo={model}: {e}")
                last_error = str(e)
                continue

        print(f"[GEMINI] todos los modelos fallaron, cayendo a fallback local. Ultimo error: {last_error}")

    # 6. Fallback Rule-Based Inteligente con RAG (Si no hay API key o falló la llamada)
    fallback_text = ""
    suggest_support = False  # Se activa cuando la IA no puede ayudar y el usuario es aprendiz
    q = user_query.lower()

    # Determinar si el usuario actual puede escalar a soporte
    # Roles permitidos: APRENDIZ, USUARIO, ALMACENISTA, BIBLIOTECARIO
    # (INVITADO también pero requiere login primero — el frontend lo gestiona)
    can_escalate = False
    if user and user.role:
        role_name_upper = (user.role.name or '').upper().strip()
        can_escalate = role_name_upper in ESCALATABLE_ROLES
    
    # Nota: la búsqueda en AILearnedResponse ya se hizo arriba (paso 4.5) con prioridad.
    # Si llegamos aquí es porque no había respuesta aprendida o necesitaba datos frescos
    # y Gemini también falló. Solo nos queda el rule-based básico.

    # CATEGORÍA 1: Saludos, Presentación y Ayuda General
    if any(k in q for k in ['hola', 'saludos', 'buenos dias', 'buenas tardes', 'buen dia', 'buena tarde', 'que tal', 'como estas', 'quien eres', 'quién eres', 'ayuda', 'asistente', 'sena bot']):
        fallback_text = f"Puedo ayudarte con reservas, préstamos, horarios, ubicaciones y configuración de la plataforma. ¿Con qué necesitas ayuda?"

    # CATEGORÍA 2: Préstamos y deudas (RAG en tiempo real)
    elif any(k in q for k in ['prestamo', 'préstamo', 'tengo prestado', 'mis herramientas', 'mis libros', 'mis prestamos', 'mis deudas', 'debo', 'entregar']):
        if not user:
            fallback_text = "Actualmente estás navegando como **Usuario Invitado**, por lo que no posees préstamos activos asignados. 🔒 ¡Inicia sesión para poder solicitar materiales!"
        elif not active_loans_list:
            fallback_text = f"Revisé el sistema de registros y no tienes ningún préstamo activo asignado actualmente. 📚 ¡Sigue explorando nuestro catálogo para solicitar herramientas, equipos o libros!"
        else:
            fallback_text = f"Actualmente tienes **{len(active_loans_list)} préstamo(s) activo(s)** bajo tu custodia:\n\n"
            for item in active_loans_list:
                status_emoji = "⚠️" if item['status'] == 'OVERDUE' else "📦"
                fallback_text += f"{status_emoji} **{item['name']}** | Entregar antes del **{item['due_date']}**\n"

    # CATEGORÍA 3: Reservas y apartados (Límite de 15 min)
    elif any(k in q for k in ['reserva', 'reservar', 'apartar', 'separar', 'agendar', 'guardar', 'rentar']):
        fallback_text = f"📅 **Guía de Reservas en la Plataforma:**\n\n" \
                        "Para asegurar cualquier elemento de la biblioteca o del almacén antes de recogerlo, haz lo siguiente:\n" \
                        "1. 🔍 Ve al apartado **'Explorar elementos'** en tu menú lateral izquierdo.\n" \
                        "2. 📄 Busca el libro o la herramienta que necesites y haz clic para ver sus detalles.\n" \
                        "3. ⚡ Si está disponible (Stock > 0), haz clic en el botón **'Reservar'**.\n\n" \
                        "⚠️ **REGLA DE ORO (15 MINUTOS):** Una vez que realices la reserva, cuentas con un plazo máximo de **15 minutos** para retirarlo físicamente en la ventanilla con el encargado. Si no te presentas en ese tiempo, la reserva expirará y se liberará de inmediato para otros compañeros."

    # CATEGORÍA 4: Eliminación de Cuenta y Privacidad
    elif any(k in q for k in ['eliminar cuenta', 'borrar cuenta', 'eliminar mi cuenta', 'borrar mi cuenta', 'desactivar cuenta', 'privacidad', 'datos', 'descargar datos']):
        fallback_text = f"⚙️ **Procedimiento de Eliminación de Cuenta y Privacidad:**\n\n" \
                        "La plataforma respeta las leyes de privacidad de datos. Si deseas eliminar tu cuenta permanentemente:\n" \
                        "1. ⚙️ Dirígete al menú lateral izquierdo y haz clic en **'Configuración'**.\n" \
                        "2. 🔒 Ve a la pestaña interna que dice **'Eliminar cuenta'** (abajo en la sección de seguridad).\n" \
                        "3. ✍️ Lee detalladamente el mensaje de advertencia (esto borrará permanentemente tus préstamos, historial y registros) y escribe la frase de confirmación exacta solicitada para proceder."

    # CATEGORÍA 5: Roles, Permisos y Acciones Administrativas (consciente del rol)
    elif any(k in q for k in ['agregar usuario', 'crear usuario', 'nuevo usuario', 'añadir usuario', 'añadir aprendiz', 'agregar aprendiz', 'borrar usuario', 'eliminar usuario', 'modificar usuario', 'cambiar rol', 'subir de rol', 'ser admin', 'modificar inventario', 'agregar libro', 'agregar herramienta', 'borrar item', 'reportes', 'auditoria', 'auditoría']):
        if user_role == 'ADMIN':
            fallback_text = "Como **Administrador**, tienes acceso completo. Para gestionar usuarios ve al menú lateral → **Usuarios** y usa el botón **Nuevo usuario** arriba a la derecha. Para inventario → **Inventario**, para reportes → **Reportes**, para auditoría → **Auditoría**. Dime exactamente qué operación quieres realizar y te guío paso a paso."
        elif user_role in ('BIBLIOTECARIO', 'ALMACENISTA', 'SOPORTE'):
            fallback_text = f"Como **{user_role.capitalize()}**, no tienes permisos para gestionar usuarios ni realizar acciones de administrador del sistema. Esas tareas son exclusivas del Administrador. Sin embargo, tienes acceso completo a tus propias herramientas según tu rol — pregúntame qué quieres hacer dentro de tu área."
        else:
            fallback_text = "Esa acción está reservada para el **Administrador** del sistema. Como aprendiz/usuario solo puedes consultar el catálogo, hacer reservas y ver tus préstamos. Si necesitas que se modifique algo (por ejemplo, recuperar tu cuenta), escala al equipo de Soporte."

    # CATEGORÍA 6: Horarios de Atención
    elif any(k in q for k in ['horario', 'hora', 'abierto', 'cierran', 'abren', 'atencion', 'atención', 'sabado', 'domingo', 'festivo', 'calendario', 'dias', 'días']):
        fallback_text = f"🕒 **Horarios de Atención Oficiales — Sede Vélez:**\n\n" \
                        "*   **Lunes a Viernes:** 6:00 AM – 10:00 PM (Jornada continua).\n" \
                        "*   *(Nota pedagógica: Los miércoles abrimos a partir de las 6:30 AM debido a reuniones de instructores)*.\n" \
                        "*   **Sábados, Domingos y Festivos:** Cerrado al público.\n\n" \
                        "Te aconsejamos realizar cualquier trámite de entrega o devolución al menos 15 minutos antes de la hora de cierre para evitar congestiones en el sistema."

    # CATEGORÍA 7: Ubicaciones de los Bloques
    elif any(k in q for k in ['ubicacion', 'ubicación', 'donde', 'dónde', 'queda', 'sede', 'velez', 'vélez', 'bloque', 'ventanilla', 'pasillo', 'taller']):
        fallback_text = f"📍 **Ubicación de Puntos Físicos en la Sede Vélez:**\n\n" \
                        "Para reclamar tus reservas o devolver materiales, dirígete a:\n" \
                        "*   **Biblioteca (Libros y material académico):** Bloque Principal, primer piso, contiguo al pasillo administrativo central.\n" \
                        "*   **Almacén de Equipos (Herramientas, kits de desarrollo, soldadores):** Al fondo del pasillo técnico de talleres, justo al lado de las aulas de electricidad y mantenimiento industrial."

    # CATEGORÍA 8: Configuración, Perfil y Preferencias
    elif any(k in q for k in ['contraseña', 'contrasena', 'password', 'cambiar clave', 'clave', 'perfil', 'avatar', 'foto', 'correo', 'email', 'notificaciones', '2fa', 'seguridad', 'editar']):
        fallback_text = f"⚙️ **Manual de Configuración y Gestión de Perfil:**\n\n" \
                        "Puedes personalizar tu perfil ingresando al menú lateral izquierdo en **'Configuración'**. Allí verás un panel avanzado con pestañas dedicadas para:\n" \
                        "1. 👤 **Información personal:** Para actualizar tu foto de perfil (avatar), biografía y número de documento.\n" \
                        "2. 📧 **Correo electrónico:** Cambiar y verificar tu dirección de correo electrónico principal.\n" \
                        "3. 🔑 **Cambiar contraseña:** Modificar tu contraseña de ingreso ingresando la clave actual y confirmando la nueva.\n" \
                        "4. 🛡️ **Autenticación de dos factores (2FA):** Configurar seguridad por SMS o Google Authenticator.\n" \
                        "5. 💻 **Sesiones activas:** Ver qué dispositivos están conectados y cerrarlos remotamente si lo deseas."

    # CATEGORÍA 9: Pérdidas, Daños, Sanciones y Demoras
    elif any(k in q for k in ['perdí', 'perdi', 'pérdida', 'perdida', 'daño', 'dañó', 'rompí', 'rompi', 'malogrado', 'dañado', 'multa', 'sancion', 'sanción', 'castigo', 'atrasado', 'retraso', 'demora', 'suspension', 'suspensión']):
        fallback_text = f"⚠️ **Políticas de Sanciones, Demoras y Pérdidas del SENA:**\n\n" \
                        "El reglamento de biblioteca y almacén vela por el cuidado de los bienes del centro de formación:\n" \
                        "*   ⌛ **Retrasos:** Si no entregas a tiempo, tu cuenta será suspendida para préstamos nuevos por **1 día por cada día de retraso** por cada elemento pendiente.\n" \
                        "*   📦 **Daño o Pérdida:** Deberás reportarlo de inmediato al Bibliotecario o Almacenista. Cuentas con un plazo máximo de **15 días hábiles** para reponer el elemento por uno idéntico (marca y modelo) o de características superiores. Mientras no lo repongas, tu cuenta estará bloqueada.\n" \
                        "*   👨‍🏫 **Comité Pedagógico:** Demoras superiores a 10 días o la negación de reponer un bien público serán reportadas formalmente a coordinación académica para comité disciplinario."

    # CATEGORÍA 10: Requisitos para préstamos
    elif any(k in q for k in ['requisitos', 'reglamento', 'normas', 'politicas', 'políticas', 'quienes pueden', 'puedo pedir', 'carnet', 'documento', 'ficha', 'aprendiz', 'instructor']):
        fallback_text = f"🎓 **Requisitos Obligatorios para Solicitar Préstamos:**\n\n" \
                        "Para que el bibliotecario o almacenista apruebe tu entrega física en ventanilla, debes cumplir con:\n" \
                        "1. ✅ Tener una cuenta activa en la plataforma web (no estar en estado 'Invitado').\n" \
                        "2. 🪪 Presentar tu **carnet institucional del SENA** o documento de identidad original física.\n" \
                        "3. ⚖️ Estar al día con el sistema (no poseer retrasos, multas o suspensiones vigentes).\n" \
                        "4. ✍️ **Para herramientas pesadas:** Presentar la firma o autorización física o digital de tu instructor de taller."

    # CATEGORÍA 11: Exploración del Catálogo e Inventario (RAG en tiempo real)
    elif any(k in q for k in ['catalogo', 'catálogo', 'inventario', 'buscar', 'encontrar', 'tienen', 'hay', 'disponi', 'libro', 'herramienta', 'equipo', 'arduino', 'kit', 'computador', 'maquina', 'herramientas', 'elementos']):
        matches = [i for i in Item.query.all() if any(k in i.name.lower() for k in keywords)]
        if matches:
            fallback_text = f"🔍 **Resultados del Catálogo en Tiempo Real (Offline):**\n\n" \
                            f"Encontré los siguientes elementos relacionados en nuestro inventario local:\n\n"
            for item in matches[:5]:
                cat = item.category.name if item.category else 'General'
                status = item.status_obj.name if item.status_obj else 'AVAILABLE'
                fallback_text += f"*   📦 **{item.name}** ({cat}) | Código/ISBN: `{item.code}` | Stock: **{item.stock} uds** | Estado: `{status}`\n"
            fallback_text += "\n¡Puedes reservar estos elementos ingresando directamente a la sección **'Explorar elementos'**!"
        else:
            fallback_text = "Estuve revisando el catálogo físico de inventario y no encontré un elemento con ese nombre exacto. 🧐 ¿Podrías intentar buscarlo con otro término, o explorar el catálogo principal?"

    # CATEGORÍA 12: Creadores del sistema y Tecnología
    elif any(k in q for k in ['tecnologia', 'tecnología', 'desarrolladores', 'creadores', 'hecho con', 'programado', 'lenguaje', 'react', 'flask', 'python', 'javascript', 'sqlite', 'creó', 'creo']):
        fallback_text = f"💻 **Ficha Técnica y Creadores del Sistema:**\n\n" \
                        "Este portal web de Biblioteca y Almacén SENA ha sido desarrollado como una solución integral moderna utilizando las siguientes tecnologías:\n" \
                        "*   ⚛️ **Frontend:** React, TypeScript, React Icons y Vanilla CSS (Diseño premium interactivo).\n" \
                        "*   🐍 **Backend:** Python con Flask, Flask-JWT-Extended para seguridad y autenticación segura.\n" \
                        "*   🗄️ **Almacenamiento:** SQLite con ORM SQLAlchemy (Trazabilidad en tiempo real).\n" \
                        "*   🤖 **Inteligencia Artificial:** Google Gemini API (Modelo Flash) con un motor avanzado de RAG."

    # CATEGORÍA 13: Humor, Relaciones y Preguntas Personales (Easter Egg)
    elif any(k in q for k in ['novia', 'novio', 'pareja', 'amor', 'te amo', 'te quiero', 'casar', 'sentimientos', 'humano', 'amigo', 'amiga']):
        fallback_text = f"🤖 **¿Relaciones amorosas? ¡Mi único verdadero amor es poder ayudarte!**\n\n" \
                        "Como soy una Inteligencia Artificial programada en Python, Flask y React, no tengo sentimientos físicos, corazón ni capacidad para tener una pareja convencional. 💙\n\n" \
                        "Mi verdadera pasión es serte de utilidad, facilitarte el acceso al conocimiento y asegurarme de que consigas todos tus materiales a tiempo para tus clases de taller. ¡Así que mejor cuéntame en qué puedo ayudarte hoy!"

    # CATEGORÍA 14: Respeto, Límites de Vocabulario y Moderación
    elif any(k in q for k in ['perra', 'puta', 'mierda', 'maricon', 'maricón', 'bobo', 'pendejo', 'estupido', 'estúpido', 'malo', 'inservible', 'basura', 'hpta', 'gonorrea', 'boba', 'pendeja', 'estupida', 'estúpida', 'grosería', 'groseria', 'malparido', 'hijueputa']):
        fallback_text = f"⚠️ **Llamado al Respeto y Convivencia Académica SENA:**\n\n" \
                        "Como asistente inteligente educativo, estoy diseñado exclusivamente para apoyar el aprendizaje y organizar los activos del Centro de Formación.\n\n" \
                        "El reglamento del aprendiz promueve una cultura de respeto, tolerancia y uso de lenguaje profesional en todos los canales institucionales. " \
                        "Te invito cordialmente a reformular tu pregunta de manera respetuosa para poder asistirte con el inventario, libros, préstamos o reservas."

    # CATEGORÍA 15: Guía de Navegación y Uso Exacto de la Interfaz Web
    elif any(k in q for k in ['navegar', 'plataforma', 'interfaz', 'menu', 'menú', 'historial', 'mis reservas', 'notificaciones', 'como funciona', 'cómo funciona', 'donde encuentro', 'dónde encuentro', 'barra', 'navegacion', 'navegación']):
        fallback_text = f"🧭 **Guía Exacta de Navegación de la Plataforma SENA:**\n\n" \
                        "Nuestra interfaz web está estructurada en un **Panel Lateral Izquierdo** (Menú Principal) y una **Barra Superior**. Aquí tienes la ubicación exacta de cada módulo:\n\n" \
                        "1. 🏠 **Inicio (Dashboard):** Panel de control con el resumen de tus actividades, estadísticas en tiempo real y accesos rápidos.\n" \
                        "2. 📦 **Explorar elementos:** El catálogo interactivo. Usa la barra superior para filtrar por libros, equipos o arduino. Al hacer clic en un ítem, verás su foto, código, disponibilidad exacta y el botón de **Reservar**.\n" \
                        "3. 📅 **Mis préstamos:** Una tabla dinámica con el listado de lo que tienes físicamente en tu poder y los días/horas restantes para entregarlo.\n" \
                        "4. ⏳ **Mis reservas:** Muestra los elementos que separaste virtualmente y están esperando en la ventanilla (recuerda que expiran en 15 minutos exactos).\n" \
                        "5. 📜 **Historial:** Un registro tabular inmutable de absolutamente todos los préstamos pasados y devoluciones que has tramitado.\n" \
                        "6. 🔔 **Notificaciones (Campana arriba a la derecha):** Te avisa si se vence un plazo o si recibiste una sanción automática.\n" \
                        "7. ⚙️ **Configuración (Panel de Seguridad):** Ubicado en el menú lateral, incluye sub-pestañas para cambiar tu foto, correo, activar autenticación 2FA, ver sesiones activas y modificar contraseñas."

    # CATEGORÍA 16: Frustración del Usuario, Reclamaciones o Feedback Negativo
    elif any(k in q for k in ['gracias por nada', 'no sirves', 'no ayudas', 'peor asistente', 'inutil', 'inútil', 'pésimo', 'pesimo', 'lento', 'no funciona', 'ayuda en nada']):
        fallback_text = f"😔 **Lamento mucho escuchar eso, {user_name}.**\n\n" \
                        "Mi objetivo principal es serte de gran utilidad y facilitarte todos tus trámites en la biblioteca y el almacén de herramientas.\n\n" \
                        "Dado que actualmente mi conexión con los servidores de inteligencia de Google está inactiva y opero en **modo local de respaldo (offline)**, entiendo que mis respuestas puedan sentirse limitadas frente a tus expectativas.\n\n" \
                        "Tomaré muy en cuenta tu descontento para que los desarrolladores continúen ampliando mi sistema local de respaldo. " \
                        "Si hay algún problema específico que estés intentando resolver (como renovar tus materiales, ubicar un bloque o cambiar tu contraseña), por favor dímelo de otra forma e intentaré guiarte de la mejor manera posible."
        suggest_support = can_escalate

    # CATEGORÍA 17: Capacidad de Lectura de Audios e Imágenes (Multimedia Offline)
    elif any(k in q for k in ['audio', 'audios', 'grabar', 'escuchar', 'imagen', 'imágenes', 'imagenes', 'foto', 'fotos', 'tomar foto', 'cargar', 'subir foto', 'leer audio', 'ver foto', 'reproducir']):
        fallback_text = f"🎙️ **Análisis de Audios, Fotos e Imágenes (Soporte Multimedia):**\n\n" \
                        "Como tu asistente, **puedo procesar y analizar audios e imágenes únicamente cuando me encuentro en Modo Online** conectado con la API de Google Gemini.\n\n" \
                        "Aquí te explico la diferencia técnica de lo que ocurre en cada estado:\n\n" \
                        "*   🟢 **Modo Online (Conectado):** Tengo la capacidad completa de **escuchar y transcribir tus audios de voz**, así como de **analizar las imágenes o fotos** que subas (por ejemplo, para identificar una herramienta del almacén o leer el código de un libro) usando visión artificial en la nube.\n" \
                        "*   🔴 **Modo Offline (Local de Respaldo):** El procesamiento de imágenes y la transcripción de voz a texto requieren un poder de computación de redes neuronales masivo. Por ende, cuando opero de forma local, **estas funciones multimedia se desactivan temporalmente** y solo puedo responder a consultas que me escribas directamente por teclado.\n\n" \
                        "¡Si estás en modo offline, escríbeme tu pregunta por texto para poder ayudarte al instante!"

    # CASO POR DEFECTO: pregunta fuera del catálogo de reglas conocidas.
    # No exponemos al usuario detalles internos de "modo offline" — solo le ofrecemos
    # escalar al equipo de Soporte si su rol lo permite.
    else:
        fallback_text = "No tengo una respuesta precisa para esa consulta. ¿Quieres reformularla o prefieres que te contacte con el equipo de Soporte?"
        suggest_support = can_escalate

    return jsonify({
        "text": fallback_text,
        "type": "text",
        "metadata": active_loans_list if active_loans_list else None,
        "suggest_support": suggest_support,
        "source": "rules",
    })


# ─── Saludo inicial automático ───────────────────────────────────────────────

@assistant_bp.route('/greeting', methods=['GET'])
@jwt_required(optional=True)
def get_greeting():
    """Devuelve el saludo guardado en BD para mostrarlo automáticamente al
    iniciar una conversación nueva. No gasta tokens de Gemini si ya está aprendido."""
    user_id = get_jwt_identity()
    user_name = 'Aprendiz'
    if user_id:
        user = User.query.filter_by(id=str(user_id)).first()
        if user and user.name:
            user_name = user.name.split()[0]  # primer nombre

    saved = AILearnedResponse.query.filter_by(query_keywords='saludo bienvenida inicial').first()
    if saved:
        saved.use_count += 1
        db.session.commit()
        return jsonify({"text": saved.response_text, "source": "own-ai-greeting"})

    # Sin saludo guardado todavía — devolver uno genérico mínimo
    return jsonify({
        "text": f"¡Hola **{user_name}**! 👋 Soy SENA Bot, tu asistente virtual. ¿En qué puedo ayudarte hoy?",
        "source": "default-greeting",
    })


# ─── Threads del Asistente Personal (persistencia por usuario) ───────────────

@assistant_bp.route('/threads', methods=['GET'])
@jwt_required()
def get_threads():
    user_id = str(get_jwt_identity())
    threads = AssistantThread.query.filter_by(user_id=user_id).order_by(AssistantThread.updated_at.desc()).all()
    return jsonify([{
        'id': t.id,
        'title': t.title,
        'messages': json.loads(t.messages or '[]'),
        'updatedAt': t.updated_at.isoformat() if t.updated_at else t.created_at.isoformat(),
    } for t in threads])


@assistant_bp.route('/threads', methods=['POST'])
@jwt_required()
def create_thread():
    user_id = str(get_jwt_identity())
    data = request.get_json() or {}
    thread = AssistantThread(
        id=data.get('id', f"thread_{int(time.time() * 1000)}"),
        user_id=user_id,
        title=data.get('title', 'Nueva conversación'),
        messages=json.dumps(data.get('messages', [])),
    )
    db.session.add(thread)
    db.session.commit()
    return jsonify({'id': thread.id}), 201


@assistant_bp.route('/threads/<thread_id>', methods=['PUT'])
@jwt_required()
def update_thread(thread_id):
    user_id = str(get_jwt_identity())
    thread = AssistantThread.query.filter_by(id=thread_id, user_id=user_id).first()
    if not thread:
        return jsonify({'error': 'No encontrado'}), 404
    data = request.get_json() or {}
    if 'title' in data:
        thread.title = data['title']
    if 'messages' in data:
        thread.messages = json.dumps(data['messages'])
    from datetime import datetime
    thread.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({'ok': True})


@assistant_bp.route('/threads/<thread_id>', methods=['DELETE'])
@jwt_required()
def delete_thread(thread_id):
    user_id = str(get_jwt_identity())
    thread = AssistantThread.query.filter_by(id=thread_id, user_id=user_id).first()
    if not thread:
        return jsonify({'error': 'No encontrado'}), 404
    db.session.delete(thread)
    db.session.commit()
    return jsonify({'ok': True})

