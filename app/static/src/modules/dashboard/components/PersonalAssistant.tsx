import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiSend, FiCpu, FiBookOpen, FiTool,
  FiClock, FiAlertCircle, FiTrash2, FiInfo, FiCheckCircle, FiPlus, FiMessageSquare,
  FiImage, FiMic, FiCamera, FiX, FiHeadphones
} from 'react-icons/fi';
import { AnimatedRobotIcon } from '../../../components/ui/AnimatedRobotIcon';
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

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
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
  type?: 'text' | 'loans' | 'help' | 'rules';
  metadata?: any;
  media?: { data: string, mimeType: string, type: 'image' | 'audio', preview: string };
  suggestSupport?: boolean;
  userQueryRef?: string;
  escalated?: { ticketId: number };
  isFromSupport?: boolean;  // Mensaje enviado por un humano de Soporte (no IA)
  supportName?: string;     // Nombre del agente de soporte
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
  const [activeTicket, setActiveTicket] = useState<{id: number, subject: string, assigned_name: string} | null>(null);
  const [seenSupportMsgIds, setSeenSupportMsgIds] = useState<Set<number>>(new Set());

  const currentRole = (user as any)?.role?.name || (user as any)?.rol?.nombre || '';
  const isApprentice = ['APRENDIZ', 'USUARIO'].includes((currentRole || '').toUpperCase());

  const [attachedMedia, setAttachedMedia] = useState<{data: string, mimeType: string, type: 'image' | 'audio', preview: string} | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const userName = user.name || user.nombre || 'Aprendiz';
  const isGuest = user.id === 0;

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
    const interval = setInterval(poll, 5000);
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
    const interval = setInterval(pollTicketMessages, 3000);
    return () => clearInterval(interval);
  }, [activeTicket, activeThreadId, isGuest]);

  // Load chat threads from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('sena_bot_threads');
    
    const newId = 'thread_' + Date.now();
    const defaultMsg: Message = {
      id: 'welcome_' + Date.now(),
      sender: 'bot',
      text: `¡Hola **${userName}**! 👋 ¿En qué puedo ayudarte hoy?`,
      timestamp: new Date().toISOString(),
      type: 'text'
    };
    const newThread: ChatThread = {
      id: newId,
      title: 'Nueva conversación',
      messages: [defaultMsg],
      updatedAt: new Date().toISOString()
    };

    if (stored) {
      try {
        const parsed: ChatThread[] = JSON.parse(stored);
        if (parsed.length > 0) {
          const updated = [newThread, ...parsed.filter((t: any) => t.messages.length > 1)];
          setThreads(updated);
          setActiveThreadId(newId);
          return;
        }
      } catch (e) {
        console.error("Error parsing chat threads:", e);
      }
    }

    setThreads([newThread]);
    setActiveThreadId(newId);
  }, [userName]);

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

  // Save chat threads to localStorage whenever they change
  const saveThreadsToStorage = (updatedThreads: ChatThread[]) => {
    localStorage.setItem('sena_bot_threads', JSON.stringify(updatedThreads));
  };

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threads, activeThreadId, isTyping]);

  const activeThread = threads.find(t => t.id === activeThreadId);
  const messages = activeThread ? activeThread.messages : [];


  const handleCreateNewChat = () => {
    const newId = 'thread_' + Date.now();
    const defaultMsg: Message = {
      id: 'welcome_' + Date.now(),
      sender: 'bot',
      text: `¡Hola **${userName}**! 👋 ¿En qué puedo ayudarte hoy?`,
      timestamp: new Date().toISOString(),
      type: 'text'
    };
    const newThread: ChatThread = {
      id: newId,
      title: 'Nueva conversación',
      messages: [defaultMsg],
      updatedAt: new Date().toISOString()
    };
    const updated = [newThread, ...threads];
    setThreads(updated);
    setActiveThreadId(newId);
    saveThreadsToStorage(updated);
  };

  const handleDeleteChat = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    const filtered = threads.filter(t => t.id !== threadId);
    
    if (filtered.length === 0) {
      // If no threads remain, create a new blank one
      const newId = 'thread_' + Date.now();
      const defaultMsg: Message = {
        id: 'welcome_' + Date.now(),
        sender: 'bot',
        text: `¡Hola **${userName}**! 👋 ¿En qué puedo ayudarte hoy?`,
        timestamp: new Date().toISOString(),
        type: 'text'
      };
      const newThread: ChatThread = {
        id: newId,
        title: 'Nueva conversación',
        messages: [defaultMsg],
        updatedAt: new Date().toISOString()
      };
      const updated = [newThread];
      setThreads(updated);
      setActiveThreadId(newId);
      saveThreadsToStorage(updated);
    } else {
      setThreads(filtered);
      saveThreadsToStorage(filtered);
      if (activeThreadId === threadId) {
        setActiveThreadId(filtered[0].id);
      }
    }
  };

  const generateSmartTitle = (query: string): string => {
    const q = query.toLowerCase();
    if (q.includes('libro') || q.includes('biblioteca')) return '📚 Consulta de libros';
    if (q.includes('prestamo') || q.includes('préstamo') || q.includes('mis prestamos') || q.includes('mis préstamos')) return '📋 Préstamos activos';
    if (q.includes('herramienta') || q.includes('almacen') || q.includes('almacén') || q.includes('equipo')) return '🛠️ Pedir herramientas';
    if (q.includes('horario') || q.includes('hora') || q.includes('abierto')) return '🕒 Horarios de atención';
    if (q.includes('ubicacion') || q.includes('ubicación') || q.includes('donde') || q.includes('dónde')) return '📍 Ubicación de sede';
    if (q.includes('retraso') || q.includes('multa') || q.includes('sancion') || q.includes('sanción')) return '⚠️ Sanciones y demoras';
    
    const words = query.trim().split(/\s+/);
    const truncated = words.slice(0, 3).join(' ');
    return truncated.length > 20 ? truncated.substring(0, 18) + '...' : truncated;
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

    // Auto rename on first user message
    if (originalTitle === 'Nueva conversación') {
      newTitle = generateSmartTitle(text);
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
    saveThreadsToStorage(updatedThreads);

    // Si hay un ticket activo (soporte tomó el caso), enviar al ticket y NO llamar a la IA
    if (activeTicket) {
      try {
        const token = localStorage.getItem('token');
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
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
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
        if (data.title) {
           finalTitle = data.title;
        }

        const botMsgId = Date.now().toString();
        const newBotMsg: Message = {
          id: botMsgId,
          sender: 'bot',
          text: data.text,
          timestamp: new Date().toISOString(),
          type: data.type || 'text',
          metadata: data.metadata,
          suggestSupport: !!data.suggest_support && isApprentice && !isGuest,
          userQueryRef: text,
        };

        const finalMessages = [...updatedMessages, newBotMsg];
        const finalThreads = updatedThreads.map(t => {
          if (t.id === activeThreadId) {
            return {
              ...t,
              title: finalTitle,
              messages: finalMessages,
              updatedAt: new Date().toISOString()
            };
          }
          return t;
        });

        setThreads(finalThreads);
        setIsTyping(false);
        saveThreadsToStorage(finalThreads);
        return; // Success, exit early!
      }
    } catch (error) {
      console.warn("Advanced backend AI failed. Running local rule-based fallback:", error);
    }

    // LOCAL FALLBACK (Runs if fetch fails or backend returns non-200)
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
          return {
            ...t,
            messages: finalMessages,
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      setThreads(finalThreads);
      setIsTyping(false);
      saveThreadsToStorage(finalThreads);
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
    if (!isApprentice || isGuest) return;
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

      // Confirmar y ofrecer ir a Solicitudes
      const goNow = confirm(
        `${data.message}\n\nTu ticket #${data.ticket_id} fue creado. ¿Quieres ir a "Solicitudes" para esperar la respuesta?`
      );
      if (goNow) {
        navigate('/dashboard/solicitudes');
      }
    } catch (err: any) {
      alert(err.message || 'No se pudo crear la solicitud.');
    } finally {
      setEscalating(null);
    }
  };

  const clearChat = () => {
    if (!activeThreadId) return;
    const defaultMsg: Message = {
      id: 'reset_' + Date.now(),
      sender: 'bot',
      text: `¡Hola **${userName}**! 👋 ¿En qué puedo ayudarte hoy?`,
      timestamp: new Date().toISOString(),
      type: 'text'
    };
    const updatedThreads = threads.map(t => {
      if (t.id === activeThreadId) {
        return {
          ...t,
          title: 'Nueva conversación',
          messages: [defaultMsg],
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    });
    setThreads(updatedThreads);
    saveThreadsToStorage(updatedThreads);
  };

  return (
    <div className="assistant-wrapper fade-in">
      {/* HEADER SECTION */}
      <div className="assistant-header">
        <div className="header-info">
          <button 
            type="button" 
            className={`sidebar-toggle-btn ${isSidebarOpen ? 'active' : ''}`}
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title={isSidebarOpen ? "Ocultar historial" : "Mostrar historial"}
          >
            <FiMessageSquare size={18} className="toggle-icon-svg" />
          </button>
          <div className="header-icon-box" style={{ background: 'var(--sena-green)' }}>
            <AnimatedRobotIcon className="glowing-icon" size="26px" style={{ color: '#ffffff' }} />
          </div>
          <div>
            <h1>Asistente Personal Inteligente</h1>
            <p>Soporte autónomo e información en tiempo real de Biblioteca & Almacén SENA</p>
          </div>
        </div>
        <button className="clear-chat-btn" onClick={clearChat} title="Restablecer chat actual">
          <FiTrash2 size={16} /> <span>Restablecer Chat</span>
        </button>
      </div>

      <div className="assistant-main-container">
        {/* CHAT HISTORY SIDEBAR (ChatGPT Style) */}
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

        {/* CHAT AREA */}
        <div className="chat-interface-card">
          <div className="messages-scroller">
            {messages.map((msg) => (
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
                        <span>Lo lamento mucho. ¿Deseas que te contacte con un <strong>administrador</strong>?</span>
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
                      <FiCheckCircle size={14} /> Solicitud #{msg.escalated.ticketId} creada. Revisa tu sección <strong>Solicitudes</strong>.
                    </div>
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

          {/* BANNER: SOPORTE ACTIVO */}
          {activeTicket && (
            <div className="support-active-banner">
              <FiHeadphones size={15} />
              <span>Estás siendo atendido por <strong>{activeTicket.assigned_name}</strong> · Soporte Técnico. La IA está pausada.</span>
            </div>
          )}

          {/* INPUT BAR */}
          <form
            className="chat-input-bar"
            onSubmit={(e) => { e.preventDefault(); handleSendMessage(inputText); }}
          >
            <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} ref={cameraInputRef} onChange={handleFileUpload} />

            {!activeTicket && (
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
                : 'Hazme una pregunta sobre biblioteca, herramientas, horarios...'}
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
