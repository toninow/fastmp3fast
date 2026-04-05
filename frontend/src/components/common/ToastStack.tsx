import { Bell } from 'lucide-react';
import { useUiStore } from '../../store/uiStore';

export function ToastStack() {
  const notifications = useUiStore((state) => state.notifications);
  const dismiss = useUiStore((state) => state.dismissNotification);

  return (
    <div className='pointer-events-none fixed right-5 top-16 z-40 flex w-[320px] flex-col gap-2'>
      {notifications.map((toast) => (
        <button
          type='button'
          key={toast.id}
          onClick={() => dismiss(toast.id)}
          className='pointer-events-auto rounded-lg border border-[#2F5B2B] bg-[#171E19] px-4 py-3 text-left shadow-[0_0_20px_rgba(163,255,18,.12)]'
        >
          <p className='flex items-center gap-2 text-xs font-semibold text-[#D8DEE7]'>
            <Bell size={14} className='text-[#A3FF12]' />
            {toast.title}
          </p>
          <p className='mt-1 text-xs text-[#A8AFB8]'>{toast.body}</p>
        </button>
      ))}
    </div>
  );
}
