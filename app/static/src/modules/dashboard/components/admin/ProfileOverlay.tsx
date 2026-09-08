import React, { useState, useRef } from 'react';
import { FiX, FiCamera, FiUpload, FiSave, FiUser, FiMail, FiShield, FiTag } from 'react-icons/fi';
import './ProfileOverlay.css';
import { apiFetch } from '../../../../shared/api';

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
  email?: string;
  profile_image?: string;
  role?: { name: string };
  rol?: { nombre: string };
  document_type?: string;
}

interface ProfileOverlayProps {
  user: UserData;
  onClose: () => void;
  onSave: (photo: string) => void;
}

export const ProfileOverlay: React.FC<ProfileOverlayProps> = ({ user, onClose, onSave }) => {
  const [showCamera, setShowCamera] = useState(false);
  const [showCrop, setShowCrop] = useState(false);
  const [tempPhoto, setTempPhoto] = useState<string | null>(user.profile_image || null);
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  };

  const userName = user.name || user.nombre || 'Usuario';
  const userRole = user.role?.name || user.rol?.nombre || 'Administrador';

  // Camera Logic
  const startCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Tu navegador no soporta el acceso a la cámara o estás en una conexión no segura (HTTP). Por favor usa localhost o HTTPS.');
      return;
    }

    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Algunos navegadores necesitan un pequeño delay para asegurar el play
        videoRef.current.play().catch(e => console.error("Error playing video:", e));
      }
    } catch (err) {
      console.error("Camera access error:", err);
      alert('No se pudo acceder a la cámara. Verifica los permisos de tu navegador.');
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;

      // Determinar el tamaño para un recorte cuadrado perfecto
      const size = Math.min(video.videoWidth, video.videoHeight);
      const startX = (video.videoWidth - size) / 2;
      const startY = (video.videoHeight - size) / 2;

      // Definir resolución de salida alta (ej. 500x500)
      canvas.width = 500;
      canvas.height = 500;

      // Aplicar efecto espejo al canvas para que coincida con la vista previa
      ctx.translate(500, 0);
      ctx.scale(-1, 1);

      // Dibujar solo el centro del video en el canvas
      ctx.drawImage(video, startX, startY, size, size, 0, 0, 500, 500);
      
      // Exportar con alta calidad (0.9 de 1.0)
      const photo = canvas.toDataURL('image/jpeg', 0.9);
      setTempPhoto(photo);
      stopCamera();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setRawImage(reader.result as string);
        setShowCrop(true);
        setZoom(1);
        setPosition({ x: 0, y: 0 });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => setIsDragging(false);

  const confirmCrop = () => {
    if (rawImage && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;
      const img = new Image();
      img.src = rawImage;
      img.onload = () => {
        const targetSize = 500;
        canvas.width = targetSize;
        canvas.height = targetSize;
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, targetSize, targetSize);
        
        const aspect = img.width / img.height;
        let drawWidth, drawHeight;
        
        if (aspect > 1) {
          drawHeight = targetSize * zoom;
          drawWidth = drawHeight * aspect;
        } else {
          drawWidth = targetSize * zoom;
          drawHeight = drawWidth / aspect;
        }
        
        const offsetX = (targetSize - drawWidth) / 2 + (position.x * 2);
        const offsetY = (targetSize - drawHeight) / 2 + (position.y * 2);
        
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        
        const cropped = canvas.toDataURL('image/jpeg', 0.9);
        setTempPhoto(cropped);
        setShowCrop(false);
      };
    }
  };

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!tempPhoto || tempPhoto === user.profile_image) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const response = await apiFetch('/api/v1/users_mgmt/profile-image', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_image: tempPhoto }),
      });

      if (response.ok) {
        // Usamos el base64 recién recortado para que el ícono se actualice al
        // instante y sin depender de la caché del navegador (el archivo del
        // servidor conserva el mismo nombre entre subidas).
        onSave(tempPhoto);
        onClose();
      } else {
        const err = await response.json().catch(() => ({}));
        // No cerramos: el usuario conserva el recorte y puede reintentar.
        alert('No se pudo guardar la foto: ' + (err.error || err.msg || err.message || 'inténtalo de nuevo'));
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Error de conexión al servidor. La foto no se guardó.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-card" onClick={e => e.stopPropagation()}>
        
        <div className="profile-header">
          <button className="btn-close-profile" onClick={onClose}><FiX /></button>
          
          <div className="profile-avatar-container">
            <div className="profile-avatar-large">
              {tempPhoto ? (
                <img src={tempPhoto} alt="Previa" />
              ) : (
                getInitials(userName)
              )}
            </div>
          </div>

          <h2 style={{ margin: '0.5rem 0 0.2rem', color: 'var(--admin-text-primary)' }}>{userName}</h2>
          <span style={{ color: 'var(--sena-green)', fontWeight: 700, fontSize: '0.9rem', textTransform: 'uppercase' }}>{userRole}</span>

          <div className="photo-edit-actions">
            <button className="btn-photo primary" onClick={startCamera}>
              <FiCamera /> Usar Cámara
            </button>
            <button className="btn-photo" onClick={() => fileInputRef.current?.click()}>
              <FiUpload /> Cargar Imagen
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              accept="image/*"
              onChange={handleFileChange}
            />
          </div>
        </div>

        <div className="profile-body">
          <div className="profile-info-group">
            <label><FiUser size={12} /> Nombre Completo</label>
            <div className="profile-info-value">{userName}</div>
          </div>

          <div className="profile-info-group">
            <label><FiShield size={12} /> Rol del Sistema</label>
            <div className="profile-info-value">{userRole}</div>
          </div>

          <div className="profile-info-group">
            <label><FiTag size={12} /> Documento / Identidad</label>
            <div className="profile-info-value">{user.id}</div>
          </div>
        </div>

        <div className="profile-footer">
          <button className="btn-save-profile" onClick={handleSave} disabled={saving}>
            <FiSave /> {saving ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>

      {showCamera && (
        <div className="camera-modal-overlay" onClick={e => e.stopPropagation()}>
          <div className="camera-container-full">
            <video ref={videoRef} autoPlay playsInline muted />
          </div>
          <div className="camera-full-actions">
            <button className="btn-photo primary" onClick={capturePhoto}>
              <FiCamera /> Capturar Foto
            </button>
            <button className="btn-photo" onClick={stopCamera}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {showCrop && (
        <div className="camera-modal-overlay" onClick={e => e.stopPropagation()}>
          <div className="crop-container">
            <h3 style={{ color: 'white', marginBottom: '1.5rem' }}>Ajustar Imagen</h3>
            <div 
              className="crop-preview-box"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div className="crop-mask"></div>
              <img 
                src={rawImage!} 
                alt="Ajuste" 
                draggable={false}
                style={{ 
                  transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  userSelect: 'none'
                }}
              />
            </div>
            
            <div className="crop-controls">
              <label style={{ color: 'var(--admin-text-muted)', fontSize: '0.8rem' }}>Zoom</label>
              <input 
                type="range" 
                min="1" 
                max="3" 
                step="0.01" 
                value={zoom} 
                onChange={e => setZoom(parseFloat(e.target.value))}
                className="zoom-slider"
              />
              
              <div className="crop-actions">
                <button className="btn-photo primary" onClick={confirmCrop}>Confirmar</button>
                <button className="btn-photo" onClick={() => setShowCrop(false)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};
