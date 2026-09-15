import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiSend, FiCpu, FiBookOpen, FiTool,
  FiClock, FiAlertCircle, FiTrash2, FiInfo, FiCheckCircle, FiPlus, FiMessageSquare,
  FiImage, FiMic, FiCamera, FiX, FiHeadphones, FiThumbsUp, FiThumbsDown
} from 'react-icons/fi';
import { AnimatedRobotIcon } from '../../../components/ui/AnimatedRobotIcon';
import { clearSessionAndRedirect } from '../../../shared/api';
import './PersonalAssistant.css';

const renderTextWithAppleEmojis = (text: string): any => {
  const emojiRegex = /([\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2194}-\u{2199}\u{21a9}-\u{21aa}\u{3297}\u{3299}])/gu;
  const singleEmojiRegex = /[\u{1f300}-\u{1f5ff}\u{1f900}-\u{1f9ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{1f1e6}-\u{1f1ff}\u{1f191}-\u{1f251}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{3030}\u{2b50}\u{2b55}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2194}-\u{2199}\u{21a9}-\u{21aa}\u{3297}\u{3299}]/u;

  const parts = text.split(emojiRegex);
  return parts.map((part, index) => {
    if (singleEmojiRegex.test(part)) {
      const codePoints: string[] = [];
      for (const char of part) {
        const cp = char.codePointAt(0);
        if (cp) codePoints.push(cp.toString(16));
      }
      const hex = codePoints.filter(cp => cp !== 'fe0f').join('-');
      const cdnUrl = `https://cdnjs.cloudflare.com/ajax/libs/emoji-datasource-apple/14.0.0/img/apple/64/${hex}.png`;
      return (
        <img 
          key={index} 
          src={cdnUrl} 
          alt={part} 
          className="apple-emoji"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
            const textNode = document.createTextNode(part);
            (e.target as HTMLElement).parentNode?.insertBefore(textNode, e.target);
          }}
        />
      );
    }
    return part;
  });
};

/** Título grande de la pantalla vacía del asistente: uno aleatorio (algunos
 * solo tienen sentido según la hora del día) cada vez que se abre una
 * conversación nueva — no es un mensaje del chat, no se guarda ni se envía. */
function pickGreetingTitle(name: string): string {
  const hour = new Date().getHours();
  const timeGreeting =
    hour >= 5 && hour < 12 ? `¡Buenos días, ${name}!` :
    hour >= 12 && hour < 19 ? `¡Buenas tardes, ${name}!` :
    `¡Buenas noches, ${name}!`;

  const pool = [
    timeGreeting,
    `¡Me alegro de verte, ${name}!`,
    `¡Cuánto tiempo, ${name}! 👀`,
    `Estamos de vuelta, ${name} 🚀`,
    `¡Otra vez por aquí, ${name}! Me gusta tu estilo 😎`,
    `¡Ey, ${name}! ¿En qué andamos hoy?`,
    `${name}, justo estaba pensando en ti 😄`,
    `¿Listo para otra ronda, ${name}?`,
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
  display_name?: string;
  role?: { name: string };
  rol?: { nombre: string };
  profile_image?: string;
}

interface PersonalAssistantProps {
  user: UserData;
}

interface Message {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  type?: 'text' | 'loans' | 'help' | 'rules' | 'navigate' | 'confirm_action';
  metadata?: any;
  media?: { data: string, mimeType: string, type: 'image' | 'audio', preview: string };
  suggestSupport?: boolean;
  userQueryRef?: string;
  escalated?: { ticketId: number };
  isFromSupport?: boolean;  // Mensaje enviado por un humano de Soporte (no IA)
  supportName?: string;     // Nombre del agente de soporte
  // Acciones automatizadas (navegar / reservar / cancelar / cerrar sesión)
  route?: string;           // type === 'navigate': a dónde llevar al usuario
  label?: string;           // type === 'navigate': etiqueta del botón
  actionToken?: string;     // type === 'confirm_action': token firmado a confirmar
  actionResolved?: 'confirmed' | 'cancelled';
  // Retroalimentación sobre respuestas de la IA que aprende
  source?: string;          // 'own-ai' = vino de una respuesta ya aprendida
  learnedId?: number;
  feedbackGiven?: 'up' | 'down';
}

interface ChatThread {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
}

export const PersonalAssistant: React.FC<PersonalAssistantProps> = ({ user }) => {
  const navigate = useNavigate();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [userLoans, setUserLoans] = useState<any[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [escalating, setEscalating] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [activeTicket, setActiveTicket] = useState<{id: number, subject: string, assigned_name: string} | null>(null);
  const [seenSupportMsgIds, setSeenSupportMsgIds] = useState<Set<number>>(new Set());

  const currentRole = (user as any)?.role?.name || (user as any)?.rol?.nombre || '';
  // Roles que pueden escalar al equipo de Soporte desde el asistente.
  // Debe coincidir con ESCALATABLE_ROLES en app/routes/assistant_routes.py
  const ESCALATABLE_ROLES = ['APRENDIZ', 'USUARIO', 'ALMACENISTA', 'BIBLIOTECARIO'];
  const canEscalate = ESCALATABLE_ROLES.includes((currentRole || '').toUpperCase());

  const [attachedMedia, setAttachedMedia] = useState<{data: string, mimeType: string, type: 'image' | 'audio', preview: string} | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isGuest = user.id === 0;
  const roleNameUpper = (currentRole || '').toUpperCase();
  // El rol genérico 'USUARIO' (cuentas públicas sin identidad verificada) se
  // saluda como "Usuario" y no guarda historial de conversaciones — igual
  // que un invitado. Todos los demás roles (Aprendiz, personal, etc.) ven su
  // nombre real (o su apodo, si lo configuraron) y sí tienen historial.
  const noHistoryRole = isGuest || roleNameUpper === 'USUARIO';
  const greetName = noHistoryRole
    ? 'Usuario'
    : (user.display_name || user.name || user.nombre || 'Usuario');

  // Pre-fetch loans for the chatbot if they are logged in
  useEffect(() => {
    if (!isGuest) {
      const fetchLoans = async () => {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch('/api/v1/loans/my', {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (response.ok) {
            const data = await response.json();
            setUserLoans(data);
          }
        } catch (error) {
          console.error("Error loading loans for assistant:", error);
        }
      };
      fetchLoans();
    }
  }, [isGuest]);

  // Polling: detectar si hay un ticket IN_PROGRESS (soporte activo) para este usuario
  useEffect(() => {
    if (isGuest) return;
    const poll = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/v1/chat/tickets/active', {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const data = await res.json();
          setActiveTicket(data.active_ticket);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 15000); // cada 15s para reducir carga
    return () => clearInterval(interval);
  }, [isGuest]);

  // Cuando hay ticket activo, hacer polling de mensajes del soporte para mostrarlos en el chat
  useEffect(() => {
    if (!activeTicket || isGuest) return;
    const pollTicketMessages = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/v1/chat/tickets/${activeTicket.id}/messages`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const msgs: any[] = data.messages || [];
        const newSupportMsgs = msgs.filter((m: any) => !m.is_mine && !seenSupportMsgIds.has(m.id));
        if (newSupportMsgs.length === 0) return;
        setSeenSupportMsgIds(prev => {
          const next = new Set(prev);
          newSupportMsgs.forEach((m: any) => next.add(m.id));
          return next;
        });
        setThreads(prev => prev.map(t => {
          if (t.id !== activeThreadId) return t;
          const existingIds = new Set(t.messages.map(m => m.id));
          const toAdd: Message[] = newSupportMsgs
            .filter((sm: any) => !existingIds.has(`support_${sm.id}`))
            .map((sm: any): Message => ({
              id: `support_${sm.id}`,
              sender: 'bot',
              text: sm.body,
              timestamp: sm.created_at || new Date().toISOString(),
              type: 'text',
              isFromSupport: true,
              supportName: sm.sender_name || activeTicket.assigned_name,
            }));
          if (toAdd.length === 0) return t;
          return { ...t, messages: [...t.messages, ...toAdd], updatedAt: new Date().toISOString() };
        }));
      } catch {}
    };
    pollTicketMessages();
    const interval = setInterval(pollTicketMessages, 8000); // cada 8s para reducir carga
    return () => clearInterval(interval);
  }, [activeTicket, activeThreadId, isGuest]);

  // Cargar threads desde la API (persistidos por cuenta). El saludo inicial
  // ya NO se pide al backend: la conversación nueva arranca sin mensajes, y
  // la pantalla vacía (título + placeholder aleatorios) se genera en el
  // propio frontend — ver el estado vacío de .messages-scroller más abajo.
  useEffect(() => {
    const loadThreads = async () => {
      const newId = 'thread_' + Date.now();
      const newThread: ChatThread = {
        id: newId,
        title: 'Nueva conversación',
        messages: [],
        updatedAt: new Date().toISOString()
      };

      if (!noHistoryRole) {
        try {
          const token = getToken();
          const res = await fetch('/api/v1/assistant/threads', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data: ChatThread[] = await res.json();
            // Siempre se entra con una conversación nueva — el historial
            // anterior sigue disponible en la barra lateral, pero ya no se
            // retoma automáticamente al abrir el asistente.
            setThreads([newThread, ...data]);
            setActiveThreadId(newId);
            return;
          }
        } catch (e) {
          console.error('Error cargando threads:', e);
        }
      }

      // Invitado o cuenta sin historial: siempre un hilo nuevo en memoria.
      setThreads([newThread]);
      setActiveThreadId(newId);
    };
    loadThreads();
  }, [user.id]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
      const base64data = reader.result as string;
      const [prefix, data] = base64data.split(',');
      const mimeType = prefix.split(':')[1].split(';')[0];
      setAttachedMedia({ data, mimeType, type: 'image', preview: base64data });
    };
    e.target.value = '';
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = reader.result as string;
          const [prefix, data] = base64data.split(',');
          const mimeType = prefix.split(':')[1].split(';')[0];
          setAttachedMedia({ data, mimeType, type: 'audio', preview: base64data });
        };
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("No se pudo acceder al micrófono.");
    }
  };

  const getToken = () => localStorage.getItem('token');

  const apiSaveThread = async (thread: ChatThread) => {
    if (noHistoryRole) return;
    const token = getToken();
    await fetch(`/api/v1/assistant/threads/${thread.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title: thread.title, messages: thread.messages }),
    }).catch(() => {});
  };

  const apiCreateThread = async (thread: ChatThread) => {
    if (noHistoryRole) return;
    const token = getToken();
    await fetch('/api/v1/assistant/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: thread.id, title: thread.title, messages: thread.messages }),
    }).catch(() => {});
  };

  const apiDeleteThread = async (threadId: string) => {
    if (noHistoryRole) return;
    const token = getToken();
    await fetch(`/api/v1/assistant/threads/${threadId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  };

  // Guardar estado local (para renderizado inmediato) y sincronizar con API
  const saveThreadsToStorage = (updatedThreads: ChatThread[], changedThread?: ChatThread) => {
    if (changedThread) {
      apiSaveThread(changedThread);
    }
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threads, activeThreadId, isTyping]);

  const activeThread = threads.find(t => t.id === activeThreadId);
  const messages = activeThread ? activeThread.messages : [];

  // Título de la pantalla vacía: uno nuevo cada vez que cambia a una
  // conversación sin mensajes (no en cada tecla que se escribe).
  const emptyStateTitle = useMemo(
    () => pickGreetingTitle(greetName),
    [activeThreadId, greetName]
  );

  const handleCreateNewChat = () => {
    const newId = 'thread_' + Date.now();
    const newThread: ChatThread = {
      id: newId,
      title: 'Nueva conversación',
      messages: [],
      updatedAt: new Date().toISOString()
    };
    const updated = [newThread, ...threads];
    setThreads(updated);
    setActiveThreadId(newId);
    apiCreateThread(newThread);
  };

  const handleDeleteChat = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    apiDeleteThread(threadId);
    const filtered = threads.filter(t => t.id !== threadId);

    if (filtered.length === 0) {
      const newId = 'thread_' + Date.now();
      const newThread: ChatThread = {
        id: newId,
        title: 'Nueva conversación',
        messages: [],
        updatedAt: new Date().toISOString()
      };
      setThreads([newThread]);
      setActiveThreadId(newId);
      apiCreateThread(newThread);
    } else {
      setThreads(filtered);
      if (activeThreadId === threadId) {
        setActiveThreadId(filtered[0].id);
      }
    }
  };

  // Genera un título de máximo 5 palabras a partir de la consulta del usuario.
  // Filtra stopwords y signos de puntuación para quedarse con palabras informativas.
  const generateSmartTitle = (query: string): string => {
    const stopwords = new Set([
      'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'de', 'del',
      'para', 'en', 'por', 'a', 'con', 'que', 'qué', 'como', 'cómo', 'cual', 'cuál',
      'te', 'me', 'se', 'lo', 'al', 'mi', 'tu', 'su', 'es', 'esta', 'está', 'ese',
      'eso', 'esto', 'son', 'soy', 'fue', 'ser', 'estar', 'hay', 'ha', 'he'
    ]);
    const cleaned = query.replace(/[¿?¡!.,;:()]/g, '').trim();
    const words = cleaned.split(/\s+/);
    const meaningful = words.filter(w => !stopwords.has(w.toLowerCase()) && w.length > 1);
    const picked = (meaningful.length >= 2 ? meaningful : words).slice(0, 5);
    const title = picked.join(' ');
    return title.length > 40 ? title.substring(0, 38) + '...' : title || 'Nueva conversación';
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || !activeThreadId) return;

    const userMsgId = Date.now().toString();
    const newUserMsg: Message = {
      id: userMsgId,
      sender: 'user',
      text: text,
      timestamp: new Date().toISOString(),
      media: attachedMedia || undefined
    };

    // Append user message immediately
    const updatedMessages = [...messages, newUserMsg];
    let originalTitle = activeThread?.title || 'Nueva conversación';
    let newTitle = originalTitle;

    // Auto rename on first user message y crear thread en BD si aún no existe
    const isFirstMessage = messages.length === 0;
    if (originalTitle === 'Nueva conversación') {
      newTitle = generateSmartTitle(text);
    }
    if (isFirstMessage) {
      apiCreateThread({ id: activeThreadId, title: newTitle, messages: [], updatedAt: new Date().toISOString() });
    }

    const updatedThreads = threads.map(t => {
      if (t.id === activeThreadId) {
        return {
          ...t,
          title: newTitle,
          messages: updatedMessages,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    });

    setThreads(updatedThreads);
    setInputText('');
    const sentMedia = attachedMedia;
    setAttachedMedia(null);
    setIsTyping(true);

    // Si hay un ticket activo Y este es el hilo que lo originó, enviar al soporte y NO llamar a la IA
    const isActiveTicketThread = activeTicket && (
      !activeTicket.source_thread_id || activeTicket.source_thread_id === activeThreadId
    );
    if (isActiveTicketThread) {
      try {
        const token = getToken();
        await fetch(`/api/v1/chat/tickets/${activeTicket.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ body: text }),
        });
      } catch (err) {
        console.warn('Error enviando mensaje al soporte:', err);
      }
      setIsTyping(false);
      return;
    }

    // Call Advanced AI Backend Endpoint with offline fallback
    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (!isGuest) {
        const token = getToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }

      const chatHistory = messages.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        text: msg.text
      }));

      const response = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ message: text, history: chatHistory, media: sentMedia || undefined })
      });

      if (response.ok) {
        const data = await response.json();

        let finalTitle = newTitle;
        if (data.title) finalTitle = data.title;

        const botMsgId = Date.now().toString();
        const newBotMsg: Message = {
          id: botMsgId,
          sender: 'bot',
          text: data.text,
          timestamp: new Date().toISOString(),
          type: data.type || 'text',
          metadata: data.metadata,
          suggestSupport: !!data.suggest_support && canEscalate && !isGuest,
          userQueryRef: text,
          route: data.route,
          label: data.label,
          actionToken: data.token,
          source: data.source,
          learnedId: data.learned_id,
        };

        const finalMessages = [...updatedMessages, newBotMsg];
        const finalThreads = updatedThreads.map(t => {
          if (t.id === activeThreadId) {
            return { ...t, title: finalTitle, messages: finalMessages, updatedAt: new Date().toISOString() };
          }
          return t;
        });
        const changedThread = finalThreads.find(t => t.id === activeThreadId);

        setThreads(finalThreads);
        setIsTyping(false);
        if (changedThread) saveThreadsToStorage(finalThreads, changedThread);
        return;
      }
    } catch (error) {
      console.warn("Advanced backend AI failed. Running local rule-based fallback:", error);
    }

    // LOCAL FALLBACK
    setTimeout(() => {
      const responseText = generateBotResponse(text);
      const botMsgId = (Date.now() + 1).toString();
      const newBotMsg: Message = {
        id: botMsgId,
        sender: 'bot',
        text: responseText.text,
        timestamp: new Date().toISOString(),
        type: responseText.type,
        metadata: responseText.metadata
      };

      const finalMessages = [...updatedMessages, newBotMsg];
      const finalThreads = updatedThreads.map(t => {
        if (t.id === activeThreadId) {
          return { ...t, messages: finalMessages, updatedAt: new Date().toISOString() };
        }
        return t;
      });
      const changedThread = finalThreads.find(t => t.id === activeThreadId);

      setThreads(finalThreads);
      setIsTyping(false);
      if (changedThread) saveThreadsToStorage(finalThreads, changedThread);
    }, 1100);
  };

  // Mensaje de error simple para cuando el backend (que ya tiene su propio
  // sistema de fallback con Gemini -> rule-based -> aprendizaje) no responde.
  const generateBotResponse = (_query: string): { text: string; type: Message['type']; metadata?: any } => {
    return {
      text: `No pude conectar con el servidor de la IA en este momento. Verifica tu conexion e intenta de nuevo en unos segundos.`,
      type: 'text'
    };
  };


  const handleEscalateToSupport = async (msgId: string, userQuery: string, aiResponse: string) => {
    if (!canEscalate || isGuest) return;
    setEscalating(msgId);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/chat/escalate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          user_query: userQuery,
          ai_response: aiResponse,
          thread_id: activeThreadId,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Error al escalar.');
      }
      const data = await res.json();

      // Marcar el mensaje como ya escalado en el thread actual
      const updatedThreads = threads.map((t) => {
        if (t.id !== activeThreadId) return t;
        return {
          ...t,
          messages: t.messages.map((m) =>
            m.id === msgId
              ? { ...m, escalated: { ticketId: data.ticket_id }, suggestSupport: false }
              : m
          ),
          updatedAt: new Date().toISOString(),
        };
      });
      setThreads(updatedThreads);
      saveThreadsToStorage(updatedThreads);

      alert(`${data.message}\n\nTicket #${data.ticket_id} creado. El equipo de Soporte te responderá en esta misma conversación.`);
    } catch (err: any) {
      alert(err.message || 'No se pudo crear la solicitud.');
    } finally {
      setEscalating(null);
    }
  };

  // Confirma (o descarta) una acción propuesta por el asistente (reservar,
  // cancelar una reserva, cerrar una sesión). El backend valida el token
  // firmado contra el usuario del JWT actual antes de ejecutar nada.
  const handleConfirmAction = async (msgId: string, actionToken: string, confirm: boolean) => {
    setActionBusy(msgId);
    try {
      const authToken = getToken();
      const res = await fetch('/api/v1/assistant/confirm-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ token: actionToken, confirm }),
      });
      const data = await res.json().catch(() => ({}));

      const replyMsg: Message = {
        id: Date.now().toString(),
        sender: 'bot',
        text: data.text || data.error || 'No pude procesar la confirmación.',
        timestamp: new Date().toISOString(),
        type: 'text',
      };

      const updatedThreads = threads.map((t) => {
        if (t.id !== activeThreadId) return t;
        return {
          ...t,
          messages: [
            ...t.messages.map((m) =>
              m.id === msgId ? { ...m, actionResolved: (confirm ? 'confirmed' : 'cancelled') as 'confirmed' | 'cancelled' } : m
            ),
            replyMsg,
          ],
          updatedAt: new Date().toISOString(),
        };
      });
      setThreads(updatedThreads);
      const changedThread = updatedThreads.find((t) => t.id === activeThreadId);
      if (changedThread) saveThreadsToStorage(updatedThreads, changedThread);

      // Si la acción confirmada cerró la sesión de ESTE dispositivo, sacar de
      // inmediato — igual que al cerrarla desde Configuración → Sesiones activas.
      if (data.session_ended) {
        clearSessionAndRedirect();
      }
    } catch (err) {
      console.error('Error confirmando acción del asistente:', err);
    } finally {
      setActionBusy(null);
    }
  };

  // 👍/👎 bajo CUALQUIER respuesta del bot (venga de la IA que aprende, de
  // Gemini en vivo o del modo offline). Solo actualiza el estado local del
  // mensaje (para deshabilitar los botones); el backend decide qué hacer con
  // cada caso (autoeliminar una entrada aprendida muy criticada, o solo
  // dejar constancia histórica de las demás).
  const handleMessageFeedback = async (msg: Message, useful: boolean) => {
    const updatedThreads = threads.map((t) => {
      if (t.id !== activeThreadId) return t;
      return {
        ...t,
        messages: t.messages.map((m) =>
          m.id === msg.id ? { ...m, feedbackGiven: (useful ? 'up' : 'down') as 'up' | 'down' } : m
        ),
      };
    });
    setThreads(updatedThreads);
    const changedThread = updatedThreads.find((t) => t.id === activeThreadId);
    if (changedThread) saveThreadsToStorage(updatedThreads, changedThread);

    try {
      const authToken = getToken();
      await fetch('/api/v1/assistant/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify(
          msg.learnedId
            ? { learned_id: msg.learnedId, useful }
            : { query_text: msg.userQueryRef, response_text: msg.text, source: msg.source || 'gemini', useful }
        ),
      });
    } catch (err) {
      console.error('Error enviando feedback:', err);
    }
  };

  const clearChat = () => {
    if (!activeThreadId) return;
    const cleared = { id: activeThreadId, title: 'Nueva conversación', messages: [], updatedAt: new Date().toISOString() };
    const updatedThreads = threads.map(t => t.id === activeThreadId ? cleared : t);
    setThreads(updatedThreads);
    saveThreadsToStorage(updatedThreads, cleared);
  };

  return (
    <div className="assistant-wrapper fade-in">
      {/* HEADER SECTION */}
      <div className="assistant-header">
        <div className="header-info">
          {!noHistoryRole && (
            <button
              type="button"
              className={`sidebar-toggle-btn ${isSidebarOpen ? 'active' : ''}`}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title={isSidebarOpen ? "Ocultar historial" : "Mostrar historial"}
            >
              <FiMessageSquare size={18} className="toggle-icon-svg" />
            </button>
          )}
          <div className="header-icon-box" style={{ background: 'var(--sena-green)' }}>
            <AnimatedRobotIcon className="glowing-icon" size="26px" style={{ color: '#ffffff' }} />
          </div>
          <div>
            <h1>Asistente Personal Inteligente</h1>
            <p>Información en tiempo real &amp; soporte autónomo</p>
          </div>
        </div>
        <button className="clear-chat-btn" onClick={clearChat} title="Restablecer chat actual">
          <FiTrash2 size={16} /> <span>Restablecer Chat</span>
        </button>
      </div>

      <div className="assistant-main-container">
        {/* CHAT HISTORY SIDEBAR (ChatGPT Style) — no aplica a cuentas sin historial */}
        {!noHistoryRole && (
        <div className={`chat-history-sidebar ${isSidebarOpen ? 'open' : 'collapsed'}`}>
          <button className="new-chat-btn" onClick={handleCreateNewChat}>
            <FiPlus size={16} />
            <span>Nueva conversación</span>
          </button>

          <div className="threads-list">
            <div className="sidebar-group-title">Historial de chats</div>
            {threads.map((t) => (
              <div
                key={t.id}
                className={`thread-item-wrapper ${t.id === activeThreadId ? 'active' : ''}`}
                onClick={() => setActiveThreadId(t.id)}
              >
                <div className="thread-item-left">
                  <FiMessageSquare size={14} className="thread-icon" />
                  <span className="thread-title-text">{t.title}</span>
                </div>
                <button
                  className="delete-thread-btn"
                  onClick={(e) => handleDeleteChat(e, t.id)}
                  title="Eliminar conversación"
                >
                  <FiTrash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* CHAT AREA */}
        <div className="chat-interface-card">
          <div className="messages-scroller">
            {messages.length === 0 ? (
              <div className="assistant-empty-state">
                <AnimatedRobotIcon className="empty-state-icon" size="56px" />
                <h2>{emptyStateTitle}</h2>
                <p>Pregúntame sobre préstamos, reservas, horarios, el catálogo o tu cuenta.</p>
              </div>
            ) : messages.map((msg) => (
              <div key={msg.id} className={`message-bubble-wrapper ${msg.sender}`}>
                {msg.sender === 'bot' && (
                  <div className="bot-avatar-wrapper" title={msg.isFromSupport ? (msg.supportName || 'Soporte') : 'SENA Bot'}>
                    {msg.isFromSupport
                      ? <div className="support-human-avatar"><FiHeadphones size={16} /></div>
                      : <AnimatedRobotIcon className="bot-chat-avatar" />
                    }
                  </div>
                )}
                
                <div className="message-content-box">
                  <div className="message-text">
                    {msg.media && (
                      msg.media.type === 'image' ? (
                        <img src={msg.media.preview} alt="Attached" className="chat-image-attachment" />
                      ) : (
                        <audio src={msg.media.preview} controls className="chat-audio-attachment" />
                      )
                    )}
                    {msg.text.split('\n').map((paragraph, pIdx) => {
                      const parts = paragraph.split(/\*\*([^*]+)\*\*/g);
                      return (
                        <p key={pIdx}>
                          {parts.map((part, partIdx) => {
                            if (partIdx % 2 === 1) {
                              return <strong key={partIdx}>{renderTextWithAppleEmojis(part)}</strong>;
                            }
                            return renderTextWithAppleEmojis(part);
                          })}
                        </p>
                      );
                    })}
                  </div>

                  {/* ESCALACIÓN A SOPORTE — visible para aprendices/usuarios cuando la IA no pudo ayudar */}
                  {msg.sender === 'bot' && msg.suggestSupport && !msg.escalated && (
                    <div className="support-escalation-box">
                      <div className="support-escalation-text">
                        <FiHeadphones size={16} />
                        <span>Lo lamento mucho. ¿Deseas que te contacte con el equipo de <strong>Soporte</strong>?</span>
                      </div>
                      <button
                        className="support-escalation-btn"
                        onClick={() => handleEscalateToSupport(msg.id, msg.userQueryRef || '', msg.text)}
                        disabled={escalating === msg.id || !msg.userQueryRef}
                      >
                        {escalating === msg.id ? 'Creando solicitud...' : 'Sí, contactar soporte'}
                      </button>
                    </div>
                  )}

                  {msg.escalated && (
                    <div className="support-escalation-done">
                      <FiCheckCircle size={14} /> Solicitud #{msg.escalated.ticketId} creada. El equipo de Soporte te responderá aquí pronto.
                    </div>
                  )}

                  {/* NAVEGACIÓN: enlace directo a una sección de la plataforma */}
                  {msg.type === 'navigate' && msg.route && (
                    <div className="assistant-action-box">
                      <button
                        className="assistant-action-btn"
                        onClick={() => navigate(msg.route!)}
                      >
                        Ir a {msg.label || 'la sección'}
                      </button>
                    </div>
                  )}

                  {/* CONFIRMACIÓN: reservar / cancelar / cerrar sesión — nunca se ejecuta sin este paso */}
                  {msg.type === 'confirm_action' && msg.actionToken && !msg.actionResolved && (
                    <div className="assistant-action-box">
                      <button
                        className="assistant-action-btn"
                        onClick={() => handleConfirmAction(msg.id, msg.actionToken!, true)}
                        disabled={actionBusy === msg.id}
                      >
                        {actionBusy === msg.id ? 'Procesando...' : 'Sí, confirmar'}
                      </button>
                      <button
                        className="assistant-action-btn secondary"
                        onClick={() => handleConfirmAction(msg.id, msg.actionToken!, false)}
                        disabled={actionBusy === msg.id}
                      >
                        No, cancelar
                      </button>
                    </div>
                  )}
                  {msg.type === 'confirm_action' && msg.actionResolved && (
                    <div className="support-escalation-done">
                      <FiCheckCircle size={14} /> {msg.actionResolved === 'confirmed' ? 'Confirmado.' : 'Descartado, sin cambios.'}
                    </div>
                  )}

                  {/* RETROALIMENTACIÓN: bajo cualquier respuesta de texto del bot
                      (no en las de Soporte humano, ni en navegación/confirmación,
                      que ya tienen su propia acción). Requiere sesión iniciada. */}
                  {msg.sender === 'bot' && !isGuest && !msg.isFromSupport &&
                   msg.type !== 'navigate' && msg.type !== 'confirm_action' && (
                    msg.feedbackGiven ? (
                      <div className="learned-feedback-done">
                        {msg.feedbackGiven === 'up' ? '¡Gracias por confirmar que sirvió!' : 'Gracias, lo tendré en cuenta.'}
                      </div>
                    ) : (
                      <div className="learned-feedback-box">
                        <span>¿Qué tal te pareció esta respuesta?</span>
                        <button className="learned-feedback-btn" onClick={() => handleMessageFeedback(msg, true)} title="Sí me sirvió">
                          <FiThumbsUp size={14} />
                        </button>
                        <button className="learned-feedback-btn" onClick={() => handleMessageFeedback(msg, false)} title="No me sirvió">
                          <FiThumbsDown size={14} />
                        </button>
                      </div>
                    )
                  )}

                  {/* CUSTOM COMPONENT: LOANS LIST */}
                  {msg.type === 'loans' && msg.metadata && (
                    <div className="chat-loans-list">
                      {msg.metadata.map((loan: any, idx: number) => (
                        <div key={idx} className="chat-loan-card">
                          <div className="loan-card-top">
                            <span className={`loan-status-tag ${loan.status === 'OVERDUE' ? 'danger' : 'success'}`}>
                              {loan.status === 'OVERDUE' ? 'Atrasado' : 'Activo'}
                            </span>
                            <span className="loan-date-text">
                              Vence: {new Date(loan.due_date).toLocaleDateString('es-CO')}
                            </span>
                          </div>
                          
                          {loan.items && loan.items.map((item: any, itemIdx: number) => (
                            <div key={itemIdx} className="loan-card-item-row">
                              <div className="item-img-placeholder">
                                {item.image_url ? (
                                  <img src={item.image_url} alt={item.name} />
                                ) : (
                                  <FiBookOpen size={16} />
                                )}
                              </div>
                              <div className="item-details">
                                <span className="item-title">{item.name}</span>
                                <span className="item-code">Código: {item.code}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  <span className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="message-bubble-wrapper bot">
                <div className="bot-avatar-wrapper typing-active">
                  <AnimatedRobotIcon className="bot-chat-avatar typing-bounce" />
                </div>
                <div className="message-content-box typing-box">
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>


          {/* MEDIA PREVIEW */}
          {attachedMedia && (
            <div className="media-preview-container">
              {attachedMedia.type === 'image' ? (
                <div className="media-preview-box">
                  <img src={attachedMedia.preview} alt="Preview" />
                  <button type="button" className="remove-media-btn" onClick={() => setAttachedMedia(null)}><FiX /></button>
                </div>
              ) : (
                <div className="media-preview-box" style={{ width: 'auto', background: 'transparent', border: 'none' }}>
                  <audio src={attachedMedia.preview} controls style={{ height: 30 }} />
                  <button type="button" className="remove-media-btn" style={{ position: 'relative', marginLeft: 8 }} onClick={() => setAttachedMedia(null)}><FiX /></button>
                </div>
              )}
            </div>
          )}

          {/* BANNER: SOPORTE ACTIVO (solo en el hilo escalado) */}
          {activeTicket && (!activeTicket.source_thread_id || activeTicket.source_thread_id === activeThreadId) && (
            <div className="support-active-banner">
              <FiHeadphones size={15} />
              <span>Estás siendo atendido por <strong>{activeTicket.assigned_name}</strong> · Soporte Técnico. La IA está pausada en esta conversación.</span>
            </div>
          )}

          {/* INPUT BAR */}
          <form
            className="chat-input-bar"
            onSubmit={(e) => { e.preventDefault(); handleSendMessage(inputText); }}
          >
            <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} ref={cameraInputRef} onChange={handleFileUpload} />

            {activeTicket && (!activeTicket.source_thread_id || activeTicket.source_thread_id === activeThreadId) && (
              <>
                <button type="button" className="attachment-btn" title="Subir imagen" onClick={() => fileInputRef.current?.click()} disabled={isTyping}>
                  <FiImage size={18} />
                </button>
                <button type="button" className="attachment-btn" title="Tomar foto" onClick={() => cameraInputRef.current?.click()} disabled={isTyping}>
                  <FiCamera size={18} />
                </button>
                <button type="button" className={`attachment-btn ${isRecording ? 'recording' : ''}`} title="Grabar audio" onClick={toggleRecording} disabled={isTyping}>
                  <FiMic size={18} />
                </button>
              </>
            )}

            <input
              type="text"
              placeholder={activeTicket
                ? `Escribe un mensaje para ${activeTicket.assigned_name}...`
                : '¿En qué puedo ayudarte?'}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isTyping}
            />
            <button type="submit" className="send-msg-btn" disabled={!inputText.trim() || isTyping}>
              <FiSend size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
