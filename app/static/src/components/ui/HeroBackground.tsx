import { useEffect, useState, type ReactNode } from 'react';

const DARK_BG = '/assets/images/Fondo negro.webp';
const LIGHT_BG = '/assets/images/Fondo blanco.webp';

const readIsLight = () =>
  typeof document !== 'undefined' &&
  document.body.classList.contains('theme-light');

type Props = {
  /**
   * 'hero'  -> landing (usa .hero-bg / .hero-overlay)
   * 'panel' -> auth y legales (usa .background-image-container / .bg-overlay)
   */
  variant?: 'hero' | 'panel';
  alt?: string;
  /** Contenido extra dentro del contenedor (p. ej. <FloatingParticles/> en la landing). */
  children?: ReactNode;
};

/**
 * Fondo del hero con las dos imágenes (tema claro y oscuro) superpuestas y
 * un crossfade por opacidad al cambiar de tema.
 *
 * Las dos <img> están siempre en el DOM, así que el navegador descarga ambas
 * al montar: el cambio de tema no dispara ninguna petición y es instantáneo,
 * sin parpadeo ni salto (las imágenes ya vienen alineadas al mismo encuadre).
 */
export const HeroBackground = ({
  variant = 'panel',
  alt = 'Biblioteca SENA',
  children,
}: Props) => {
  const [isLight, setIsLight] = useState(readIsLight);

  useEffect(() => {
    const sync = () => setIsLight(readIsLight());
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('storage', sync);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', sync);
    };
  }, []);

  const wrapperClass = variant === 'hero' ? 'hero-bg' : 'background-image-container';
  const overlayClass = variant === 'hero' ? 'hero-overlay' : 'bg-overlay';

  return (
    <div className={wrapperClass}>
      <div className="hb-layer" style={{ opacity: isLight ? 0 : 1 }}>
        <img
          src={DARK_BG}
          alt={isLight ? '' : alt}
          aria-hidden={isLight}
          fetchPriority={isLight ? 'low' : 'high'}
          decoding="async"
          draggable={false}
        />
      </div>
      <div className="hb-layer" style={{ opacity: isLight ? 1 : 0 }}>
        <img
          src={LIGHT_BG}
          alt={isLight ? alt : ''}
          aria-hidden={!isLight}
          fetchPriority={isLight ? 'high' : 'low'}
          decoding="async"
          draggable={false}
        />
      </div>
      <div className={overlayClass}></div>
      {children}
    </div>
  );
};
