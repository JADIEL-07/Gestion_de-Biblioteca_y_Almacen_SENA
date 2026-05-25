import React, { useState, useEffect, useRef } from 'react';
import { Accessibility, X, Type, Contrast, Moon, Baseline, RotateCcw } from 'lucide-react';
import './AccessibilityWidget.css';

export const AccessibilityWidget: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [textSize, setTextSize] = useState(100);
  const [highContrast, setHighContrast] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const stored = localStorage.getItem('dashboard-theme');
    return stored ? stored === 'dark' : true;
  });
  const [textSpacing, setTextSpacing] = useState(false);
  
  const [windowWidth, setWindowWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1200);
  const [windowHeight, setWindowHeight] = useState(() => typeof window !== 'undefined' ? window.innerHeight : 800);

  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 };
    }
    return {
      x: window.innerWidth - 85 - 30,
      y: window.innerHeight - 85 - 30,
    };
  });
  const [isDragging, setIsDragging] = useState(false);
  
  // Estados para el efecto de hover en los botones de tamaño
  const [hoveringPlus, setHoveringPlus] = useState(false);
  const [hoveringMinus, setHoveringMinus] = useState(false);
  
  const widgetRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  // Escuchar cambios de tamaño de ventana para ajustar el widget y recalcular límites
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      setWindowHeight(window.innerHeight);
      // Mantener el botón dentro de los límites si la ventana se encoge
      setPosition(prev => {
        const maxX = window.innerWidth - 65;
        const maxY = window.innerHeight - 65;
        return {
          x: Math.min(Math.max(prev.x, 10), maxX),
          y: Math.min(Math.max(prev.y, 10), maxY)
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Cerrar el panel al hacer clic fuera de él
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Efectos de accesibilidad al cambiar los estados
  useEffect(() => {
    // Tamaño de texto
    document.documentElement.style.fontSize = `${textSize}%`;
  }, [textSize]);

  useEffect(() => {
    // Alto contraste
    if (highContrast) {
      document.body.classList.add('accessibility-high-contrast');
    } else {
      document.body.classList.remove('accessibility-high-contrast');
    }
  }, [highContrast]);

  useEffect(() => {
    // Espaciado de texto
    if (textSpacing) {
      document.body.classList.add('accessibility-text-spacing');
    } else {
      document.body.classList.remove('accessibility-text-spacing');
    }
  }, [textSpacing]);

  useEffect(() => {
    // Modo oscuro global
    if (darkMode) {
      document.body.classList.remove('theme-light');
      localStorage.setItem('dashboard-theme', 'dark');
    } else {
      document.body.classList.add('theme-light');
      localStorage.setItem('dashboard-theme', 'light');
    }
    window.dispatchEvent(new Event('storage'));
  }, [darkMode]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStartRef.current) return;

      const dx = event.clientX - dragStartRef.current.startX;
      const dy = event.clientY - dragStartRef.current.startY;
      const maxX = window.innerWidth - 65;
      const maxY = window.innerHeight - 65;
      const newX = Math.min(Math.max(dragStartRef.current.originX + dx, 10), maxX);
      const newY = Math.min(Math.max(dragStartRef.current.originY + dy, 10), maxY);
      setPosition({ x: newX, y: newY });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    setIsDragging(true);
  };

  const increaseText = () => setTextSize(prev => Math.min(prev + 10, 150));
  const decreaseText = () => setTextSize(prev => Math.max(prev - 10, 80));

  const resetAll = () => {
    setTextSize(100);
    setHighContrast(false);
    setDarkMode(true);
    setTextSpacing(false);
  };

  const isRightHalf = position.x > windowWidth / 2;
  const isBottomHalf = position.y > windowHeight / 2;

  const alignmentClass = `${isRightHalf ? 'align-right' : 'align-left'} ${isBottomHalf ? 'align-top' : 'align-bottom'}`;
  const isMobile = windowWidth <= 640;

  return (
    <>
      {isOpen && isMobile && (
        <div className="accessibility-mobile-overlay" onClick={() => setIsOpen(false)} />
      )}
      <div 
        className={`accessibility-widget-container ${isDragging ? 'dragging' : ''} ${isOpen ? 'panel-open' : ''}`} 
        ref={widgetRef} 
        style={{ top: position.y, left: position.x }}
      >
        {isOpen && (
          <div className={`accessibility-panel fade-in-up ${alignmentClass}`}>
            <div className="acc-header">
              <div className="acc-icon-box">
                <Accessibility size={24} strokeWidth={2.5} />
              </div>
              <div className="acc-title-group">
                <h3>Accesibilidad</h3>
                <p>Personaliza tu experiencia</p>
              </div>
              <button className="acc-close" onClick={() => setIsOpen(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="acc-grid">
              {/* Tamaño de texto Dinámico */}
              <div className="acc-card size-card-custom">
                <div className="acc-card-icon-custom"><Type size={28} /></div>
                <span className="acc-card-label-custom">Letra</span>
                
                <div className="acc-stepper-base">
                  <button 
                    onClick={decreaseText} 
                    className="stepper-btn-base"
                    onMouseEnter={() => setHoveringMinus(true)}
                    onMouseLeave={() => setHoveringMinus(false)}
                  >
                    {hoveringMinus ? `${textSize}%` : "−"}
                  </button>
                  
                  <button 
                    onClick={increaseText} 
                    className="stepper-btn-base"
                    onMouseEnter={() => setHoveringPlus(true)}
                    onMouseLeave={() => setHoveringPlus(false)}
                  >
                    {hoveringPlus ? `${textSize}%` : "+"}
                  </button>
                </div>
              </div>

              {/* Alto Contraste */}
              <button 
                className={`acc-card btn-card ${highContrast ? 'active' : ''}`}
                onClick={() => setHighContrast(!highContrast)}
              >
                <div className="acc-card-icon"><Contrast size={28} /></div>
                <span className="acc-card-label">Alto contraste</span>
              </button>

              {/* Modo oscuro */}
              <button 
                className={`acc-card btn-card ${darkMode ? 'active' : ''}`}
                onClick={() => setDarkMode(!darkMode)}
              >
                <div className="acc-card-icon"><Moon size={28} /></div>
                <span className="acc-card-label">Modo oscuro</span>
              </button>

              {/* Espaciado texto */}
              <button 
                className={`acc-card btn-card ${textSpacing ? 'active' : ''}`}
                onClick={() => setTextSpacing(!textSpacing)}
              >
                <div className="acc-card-icon"><Baseline size={28} /></div>
                <span className="acc-card-label">Espaciado<br/>texto</span>
              </button>
            </div>

            {/* Footer Reset */}
            <div className="acc-footer">
              <button className="acc-reset-btn" onClick={resetAll}>
                <RotateCcw size={16} /> 
                Restablecer todo
              </button>
            </div>
          </div>
        )}

        <button 
          className={`accessibility-btn ${isOpen ? 'pulse-off' : ''}`} 
          aria-label="Opciones de Accesibilidad"
          onClick={() => setIsOpen(!isOpen)}
          onPointerDown={handlePointerDown}
        >
          <Accessibility size={32} strokeWidth={2.5} />
        </button>
      </div>
    </>
  );
};
