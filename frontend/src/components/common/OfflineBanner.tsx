import { WifiOff } from 'lucide-react';

export function OfflineBanner() {
  return (
    <div className='mb-4 flex items-center gap-2 rounded-lg border border-[#6B6420] bg-[#2B2B16] px-4 py-2 text-xs text-[#F7E733]'>
      <WifiOff size={16} />
      Modo offline activo. Las acciones nuevas quedarán en cola local y se sincronizarán al reconectar.
    </div>
  );
}
