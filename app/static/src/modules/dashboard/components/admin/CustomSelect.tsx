import React, { useState, useRef, useEffect } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import './CustomSelect.css';

interface Option {
  id: string | number;
  name: string;
}

interface CustomSelectProps {
  label?: string;
  options: Option[];
  value: string | number;
  onChange: (value: any) => void;
  placeholder?: string;
  icon?: React.ReactNode;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({ 
  label, options, value, onChange, placeholder = 'Seleccionar...', icon 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(o => String(o.id) === String(value));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`custom-select-container ${isOpen ? 'open' : ''}`} ref={containerRef}>
      {label && <label className="custom-select-label">{label}</label>}
      <div 
        className={`custom-select-trigger ${isOpen ? 'open' : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
        tabIndex={0}
      >
        <div className="trigger-content">
          {icon && <span className="trigger-icon">{icon}</span>}
          <span className="trigger-text">
            {selectedOption ? selectedOption.name : placeholder}
          </span>
        </div>
        <FiChevronDown className={`chevron-icon ${isOpen ? 'rotate' : ''}`} />
      </div>

      {isOpen && (
        <div className="custom-select-dropdown">
          {options.length > 0 ? (
            options.map((option) => (
              <div 
                key={option.id} 
                className={`custom-select-option ${String(option.id) === String(value) ? 'selected' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(option.id);
                  setIsOpen(false);
                }}
                title={option.name}
              >
                <span className="custom-select-option-text">{option.name}</span>
                {String(option.id) === String(value) && <div className="selected-dot" />}
              </div>
            ))
          ) : (
            <div className="custom-select-no-options">Sin opciones</div>
          )}
        </div>
      )}
    </div>
  );
};
