import type { PropsWithChildren } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MiniPlayer } from '../player/MiniPlayer';
import { ToastStack } from '../common/ToastStack';
import { useUiStore } from '../../store/uiStore';

export function AppShell({ children }: PropsWithChildren) {
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);

  return (
    <div className='min-h-screen bg-[#090B0D] text-[#E7ECF3]'>
      <Sidebar mobile open={sidebarOpen} />
      {sidebarOpen && (
        <button
          type='button'
          aria-label='Cerrar menu'
          onClick={() => setSidebarOpen(false)}
          className='fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] lg:hidden'
        />
      )}

      <div className='flex min-h-screen'>
        <Sidebar />

        <div className='relative flex min-h-screen flex-1 flex-col'>
          <Topbar />
          <main className='flex-1 px-4 pb-40 pt-4 md:px-6'>{children}</main>
        </div>
      </div>

      <ToastStack />
      <MiniPlayer />
    </div>
  );
}
