import {
  Bolt,
  Clock3,
  Download,
  Grid2x2,
  Library,
  ListMusic,
  LogOut,
  Settings,
  Shuffle,
  X,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';

const items = [
  { to: '/dashboard', label: 'Dashboard', icon: Grid2x2 },
  { to: '/downloads/new', label: 'Nueva descarga', icon: Download },
  { to: '/library', label: 'Biblioteca', icon: Library },
  { to: '/collections', label: 'Listas', icon: ListMusic },
  { to: '/history', label: 'Historial', icon: Clock3 },
  { to: '/sync', label: 'Sincronizacion', icon: Shuffle },
  { to: '/settings', label: 'Configuracion', icon: Settings },
];

interface SidebarProps {
  mobile?: boolean;
  open?: boolean;
}

export function Sidebar({ mobile = false, open = true }: SidebarProps) {
  const navigate = useNavigate();
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const clearSession = useAuthStore((state) => state.clearSession);

  const handleCloseMobile = () => {
    if (mobile) {
      setSidebarOpen(false);
    }
  };

  const handleLogout = async () => {
    await clearSession();
    setSidebarOpen(false);
    navigate('/login', { replace: true });
  };

  const baseClasses = mobile
    ? [
        'fixed inset-y-0 left-0 z-50 w-[280px] border-r border-[#242A30] bg-[#111417] px-4 py-4 shadow-[0_0_28px_rgba(0,0,0,.55)]',
        'transform transition-transform duration-200 lg:hidden',
        open ? 'translate-x-0' : '-translate-x-full',
      ].join(' ')
    : 'hidden h-screen w-[260px] shrink-0 border-r border-[#242A30] bg-[#111417] px-4 py-6 lg:sticky lg:top-0 lg:block';

  return (
    <aside className={baseClasses}>
      <div className='mb-6 rounded-xl border border-[#2F5B2B] bg-[#131A15] px-4 py-3 shadow-[0_0_22px_rgba(163,255,18,.08)]'>
        <div className='flex items-center justify-between gap-2'>
          <p className='flex items-center gap-2 text-lg font-bold tracking-[0.08em] text-[#F3F6FA]'>
            <Bolt size={18} className='text-[#A3FF12]' /> FASTMP3FAST
          </p>
          {mobile && (
            <button
              type='button'
              onClick={handleCloseMobile}
              className='grid h-8 w-8 place-items-center rounded-md border border-[#3B4148] bg-[#1A1F24] text-[#D3DAE3]'
            >
              <X size={14} />
            </button>
          )}
        </div>
        <p className='mt-1 text-xs text-[#A8AFB8]'>Private Offline Library</p>
      </div>

      <nav className='space-y-1'>
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={handleCloseMobile}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition',
                isActive
                  ? 'border-[#2F5B2B] bg-[#162016] text-[#A3FF12] shadow-[0_0_14px_rgba(163,255,18,.12)]'
                  : 'border-transparent text-[#C9CFD6] hover:border-[#353B41] hover:bg-[#171B1F] hover:text-[#F1F5F9]',
              ].join(' ')
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      <button
        type='button'
        onClick={() => {
          void handleLogout();
        }}
        className='mt-8 flex w-full items-center gap-3 rounded-lg border border-[#3B4148] bg-[#1A1F24] px-3 py-2 text-sm text-[#D3DAE3] transition hover:border-[#6F671D] hover:text-[#F7E733]'
      >
        <LogOut size={16} />
        Cerrar sesion
      </button>
    </aside>
  );
}
