import React, { useState } from 'react';
import { FiEye, FiLogOut, FiChevronDown } from 'react-icons/fi';
import { isImpersonating, getImpersonationInfo, exitImpersonation, switchToRole } from '../../shared/impersonation';
import './ImpersonationBanner.css';

const ROLE_LABELS: Record<string, string> = {
  APRENDIZ: 'Aprendiz',
  BIBLIOTECARIO: 'Bibliotecario',
  ALMACENISTA: 'Almacenista',
  SOPORTE_TECNICO: 'Soporte Técnico',
};

/**
 * Banner fijo, independiente de cualquier dashboard: se monta una sola vez
 * en App.tsx por fuera de las rutas, así que sigue visible sin importar a
 * qué vista haya cambiado el Admin. Es la salida garantizada para nunca
 * quedar "atrapado" navegando como otro rol.
 */
export const ImpersonationBanner: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  if (!isImpersonating()) return null;

  const info = getImpersonationInfo();
  if (!info) return null;

  const handleSwitch = async (role: string) => {
    if (role === info.role || switching) return;
    setSwitching(true);
    // Volver primero a la sesión real de Admin y desde ahí pedir el nuevo rol,
    // para no encadenar sombras (siempre se parte de la identidad real).
    const adminToken = localStorage.getItem('admin_backup_token');
    const adminUser = localStorage.getItem('admin_backup_user');
    if (adminToken) localStorage.setItem('token', adminToken);
    if (adminUser) localStorage.setItem('user', adminUser);
    await switchToRole(role, info.adminName);
  };

  return (
    <div className="impersonation-banner">
      <div className="impersonation-banner-info">
        <FiEye />
        <span>
          Viendo como <strong>{ROLE_LABELS[info.role] || info.role}</strong> — sesión de prueba de {info.adminName}
        </span>
      </div>

      <div className="impersonation-banner-actions">
        <div className="impersonation-switch">
          <button className="impersonation-switch-btn" onClick={() => setOpen(!open)} disabled={switching}>
            Cambiar de rol <FiChevronDown />
          </button>
          {open && (
            <div className="impersonation-switch-menu">
              {Object.keys(ROLE_LABELS).filter(r => r !== info.role).map(role => (
                <button key={role} onClick={() => { setOpen(false); handleSwitch(role); }}>
                  {ROLE_LABELS[role]}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="impersonation-exit-btn" onClick={exitImpersonation}>
          <FiLogOut /> Volver a mi cuenta de Admin
        </button>
      </div>
    </div>
  );
};
