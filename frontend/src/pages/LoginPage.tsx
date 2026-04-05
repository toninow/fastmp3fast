import { Lock, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import { db } from '../lib/db/database';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { apiEndpoints } from '../lib/api/endpoints';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const online = useOnlineStatus();

  const [login, setLogin] = useState('antonio');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!online) {
      const cached = await db.cachedUser.get('current');
      if (cached) {
        await setSession(cached.user, cached.token);
        navigate('/dashboard', { replace: true });
        return;
      }

      setError('Sin conexión y sin sesión cacheada válida.');
      return;
    }

    try {
      const response = await apiEndpoints.login({ login, password, remember });
      const user = response?.data?.user;
      const token = response?.data?.token;

      if (!user || !token) {
        setError('Respuesta inválida del servidor.');
        return;
      }

      await setSession(user, token);
      navigate('/dashboard', { replace: true });
      return;
    } catch (error) {
      const apiDetail = axios.isAxiosError(error) ? (error.response?.data?.detail ?? error.response?.data?.message) : null;
      const message = String(apiDetail ?? (error instanceof Error ? error.message : 'No se pudo iniciar sesión.'));
      setError(`Login falló: ${message}`);
      return;
    }
  };

  return (
    <div className='relative grid min-h-screen place-items-center overflow-hidden bg-[#07090A] p-4'>
      <div className='absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(163,255,18,.08),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(247,231,51,.08),transparent_30%)]' />

      <form
        onSubmit={submit}
        className='relative z-10 w-full max-w-md rounded-2xl border border-[#2A3036] bg-[#101418]/95 p-7 shadow-[0_0_45px_rgba(0,0,0,.55)]'
      >
        <img src='/branding/logo-wordmark.png' alt='FASTMP3FAST' className='h-10 w-auto max-w-[260px] object-contain' />
        <p className='mt-2 text-sm text-[#A8AFB8]'>Acceso privado a tu biblioteca multimedia offline-first.</p>

        <label className='mt-6 block text-xs uppercase tracking-[0.08em] text-[#8B95A0]'>Usuario</label>
        <div className='mt-2 flex items-center rounded-lg border border-[#2A3036] bg-[#151A1F] px-3'>
          <UserRound size={14} className='text-[#A3FF12]' />
          <input
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            className='h-11 w-full bg-transparent px-2 text-sm text-[#E2E8F0] outline-none'
            placeholder='antonio'
          />
        </div>

        <label className='mt-4 block text-xs uppercase tracking-[0.08em] text-[#8B95A0]'>Contraseña</label>
        <div className='mt-2 flex items-center rounded-lg border border-[#2A3036] bg-[#151A1F] px-3'>
          <Lock size={14} className='text-[#F7E733]' />
          <input
            type='password'
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className='h-11 w-full bg-transparent px-2 text-sm text-[#E2E8F0] outline-none'
            placeholder='••••••••'
          />
        </div>

        <label className='mt-4 inline-flex items-center gap-2 text-xs text-[#A9B1BC]'>
          <input
            type='checkbox'
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className='accent-[#A3FF12]'
          />
          Mantener sesión
        </label>

        {error && <p className='mt-4 rounded-lg border border-[#5A2028] bg-[#2A1316] px-3 py-2 text-xs text-[#FFB7BD]'>{error}</p>}

        <button
          type='submit'
          className='mt-6 h-11 w-full rounded-lg border border-[#2F5B2B] bg-[#182516] text-sm font-semibold text-[#A3FF12] shadow-[0_0_18px_rgba(163,255,18,.14)] transition hover:bg-[#1F2E1C]'
        >
          Entrar a FASTMP3FAST
        </button>
      </form>
    </div>
  );
}
