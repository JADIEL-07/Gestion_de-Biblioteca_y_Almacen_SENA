import React from 'react';
import { 
  FiLayers, 
  FiBookOpen, 
  FiMonitor, 
  FiTool, 
  FiBox,
  FiCpu
} from 'react-icons/fi';

// Placeholder local para imágenes de elementos sin foto.
// (Antes se usaba https://via.placeholder.com, un servicio que dejó de existir
//  y por eso los <img> salían rotos.) Es un SVG embebido: no depende de la red.
const _imgPlaceholderSvg =
  "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>" +
  "<rect width='160' height='160' fill='#e2e8f0'/>" +
  "<circle cx='58' cy='58' r='13' fill='#94a3b8'/>" +
  "<path d='M24 126l36-44 26 30 20-22 30 36z' fill='#94a3b8'/>" +
  "</svg>";
export const IMAGE_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(_imgPlaceholderSvg)}`;

export const SERVICES_DATA = [
  {
    id: 'all',
    title: 'Todos los elementos',
    icon: <FiLayers />,
    description: 'Vista completa de todos los recursos institucionales.'
  },
  {
    id: 'books',
    title: 'Libros',
    icon: <FiBookOpen />,
    description: 'Gestion y reserva de material bibliografico institucional.'
  },
  {
    id: 'equipment',
    title: 'Equipos',
    icon: <FiMonitor />,
    description: 'Prestamo y retorno de activos tecnicos especializados.'
  },
  {
    id: 'tools',
    title: 'Herramientas',
    icon: <FiTool />,
    description: 'Seguimiento en tiempo real de inventarios y existencias.'
  },
  {
    id: 'supplies',
    title: 'Insumos',
    icon: <FiBox />,
    description: 'Suministros consumibles para programas tecnicos.'
  },
  {
    id: 'ai-assistant',
    title: 'Asistente Personal',
    icon: <FiCpu />,
    description: 'Un asistente inteligente diseñado para guiarte y facilitar el flujo por toda la web.'
  }
];

export const DUMMY_CATALOG = [
  {
    id: 1,
    nombre: 'Portatil HP 250 G8',
    categoria: 'Equipos Tecnologicos',
    estado: 'Disponible',
    imagen: 'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=400&q=80'
  },
  {
    id: 2,
    nombre: 'Camara Canon EOS 2000D',
    categoria: 'Equipos Tecnologicos',
    estado: 'Disponible',
    imagen: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&q=80'
  },
  {
    id: 3,
    nombre: 'Libro: Fundamentos de Redes',
    categoria: 'Libros',
    estado: 'Reservado',
    imagen: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=400&q=80'
  }
];
