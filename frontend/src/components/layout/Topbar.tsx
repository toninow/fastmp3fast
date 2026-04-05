import { Bell, Menu, Search, UserRound, Wifi, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db/database';
import { useUiStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';
import { getSyncStatusClass, getSyncStatusText } from '../../lib/syncStatus';

export function Topbar() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const search = useUiStore((state) => state.search);
  const setSearch = useUiStore((state) => state.setSearch);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const sync = useLiveQuery(() => db.syncState.get('global'));
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);
  const submitSearch = () => {
    const q = search.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };
  const syncStatus = sync?.status ?? (online ? 'idle' : 'offline');
  const syncText = getSyncStatusText(syncStatus, { compact: true });
  const syncClass = getSyncStatusClass(syncStatus);

  return (
    <header className='sticky top-0 z-30 border-b border-[#242A30] bg-[#0D1114]/95 px-3 py-3 backdrop-blur md:px-4'>
      <div className='flex items-center gap-2 md:gap-3'>
        <button
          type='button'
          onClick={toggleSidebar}
          className='grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#2A3036] bg-[#14191E] text-[#D1D9E2] lg:hidden'
          aria-label={sidebarOpen ? 'Cerrar menu' : 'Abrir menu'}
        >
          <Menu size={18} />
        </button>

        <div className='flex h-10 flex-1 items-center rounded-lg border border-[#2A3036] bg-[#14191E] px-3'>
          <button
            type='button'
            onClick={submitSearch}
            className='text-[#8D96A1] transition hover:text-[#A3FF12]'
            aria-label='Buscar'
          >
            <Search size={16} />
          </button>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitSearch();
              }
            }}
            placeholder='Buscar en descargas, listas o historial...'
            className='ml-2 w-full bg-transparent text-sm text-[#E5E9EF] outline-none placeholder:text-[#6C7580]'
          />
        </div>

        <div
          className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] ${
            online
              ? 'border-[#2F5B2B] bg-[#131F15] text-[#A3FF12]'
              : 'border-[#6B6420] bg-[#2B2B16] text-[#F7E733]'
          }`}
        >
          {online ? <Wifi size={12} className='mr-1 inline' /> : <WifiOff size={12} className='mr-1 inline' />}
          {online ? 'online' : 'offline'}
        </div>

        <div className='hidden rounded-lg border border-[#2A3036] bg-[#14191E] px-3 py-2 text-xs text-[#C8D0D8] md:block'>
          Sincronización: <span className={`font-semibold ${syncClass}`}>{syncText}</span>
        </div>

        <button
          type='button'
          className='hidden h-10 w-10 place-items-center rounded-lg border border-[#2A3036] bg-[#14191E] text-[#A8AFB8] hover:text-[#F7E733] md:grid'
        >
          <Bell size={16} />
        </button>

        <button
          type='button'
          onClick={() => {
            void clearSession().then(() => navigate('/login', { replace: true }));
          }}
          className='flex h-10 items-center gap-2 rounded-lg border border-[#2A3036] bg-[#14191E] px-2 text-xs font-semibold text-[#DCE2EA] md:px-3'
        >
          <UserRound size={14} className='text-[#A3FF12]' />
          <span className='hidden sm:inline'>{user?.username ?? user?.name ?? 'user'}</span>
        </button>
      </div>
    </header>
  );
}
