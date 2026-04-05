import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ChangeEvent, type ReactNode } from 'react';
import { db } from '../lib/db/database';
import { apiEndpoints } from '../lib/api/endpoints';

export function SettingsPage() {
  const settings = useLiveQuery(() => db.settings.toArray(), []);
  const [ytDlp, setYtDlp] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [ffmpeg, setFfmpeg] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [systemMessage, setSystemMessage] = useState<string>('Sin comprobar');
  const [cookiesConfigured, setCookiesConfigured] = useState<boolean>(false);
  const [cookiesPath, setCookiesPath] = useState<string | null>(null);
  const [cookiesMessage, setCookiesMessage] = useState<string>('Sin archivo');
  const [cookiesBusy, setCookiesBusy] = useState<boolean>(false);

  const ping = async () => {
    try {
      const response = await apiEndpoints.systemStatus();
      const data = response?.data ?? {};
      setYtDlp(data?.yt_dlp?.available ? 'ok' : 'fail');
      setFfmpeg(data?.ffmpeg?.available ? 'ok' : 'fail');
      setCookiesConfigured(Boolean(data?.yt_dlp?.cookies_configured));
      setCookiesPath(data?.yt_dlp?.cookies_path ? String(data.yt_dlp.cookies_path) : null);
      setSystemMessage(`Python ${data?.python_version ?? 'N/A'} • Queue ${data?.queue_pending ?? 0}`);
      setCookiesMessage(data?.yt_dlp?.cookies_configured ? 'Cookies activas para YouTube' : 'Sin cookies para YouTube');
    } catch {
      setYtDlp('fail');
      setFfmpeg('fail');
      setSystemMessage('No se pudo consultar el backend.');
      setCookiesMessage('No se pudo comprobar cookies.');
    }
  };

  const onUploadCookies = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setCookiesBusy(true);
    try {
      await apiEndpoints.uploadYoutubeCookies(file);
      setCookiesMessage(`Cookies subidas: ${file.name}`);
      await ping();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron subir las cookies.';
      setCookiesMessage(`Error: ${message}`);
    } finally {
      setCookiesBusy(false);
    }
  };

  const onDeleteCookies = async () => {
    setCookiesBusy(true);
    try {
      await apiEndpoints.deleteYoutubeCookies();
      setCookiesMessage('Cookies eliminadas.');
      await ping();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudieron eliminar las cookies.';
      setCookiesMessage(`Error: ${message}`);
    } finally {
      setCookiesBusy(false);
    }
  };

  return (
    <section className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold text-[#EFF4FA]'>Configuración</h1>
        <p className='text-sm text-[#96A0AB]'>Apariencia, reproducción, sincronización y estado del sistema.</p>
      </div>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Block title='Apariencia'>
          Tema FASTMP3FAST Dark Neon
        </Block>
        <Block title='Calidad por defecto'>
          Video 1080p, audio 320kbps, miniatura y metadata activadas.
        </Block>
        <Block title='Subtítulos por defecto'>
          Español habilitado + fallback manual.
        </Block>
        <Block title='Reproducción'>
          Recordar progreso y volumen, autoplay opcional.
        </Block>
        <Block title='Sincronización'>
          Modo automático cada 20s con reintentos limitados.
        </Block>
        <Block title='Estado del sistema'>
          <div className='mt-2 flex gap-2'>
            <button type='button' className='simple-btn' onClick={() => void ping()}>
              Probar backend tools
            </button>
          </div>
          <p className='mt-2 text-xs text-[#A8B1BC]'>yt-dlp: {ytDlp} • ffmpeg: {ffmpeg}</p>
          <p className='mt-1 text-xs text-[#8F99A5]'>{systemMessage}</p>
        </Block>

        <Block title='YouTube Cookies'>
          <p className='text-xs text-[#9EA8B4]'>
            Si YouTube bloquea con “Sign in to confirm you are not a bot”, sube aquí tu `cookies.txt` (formato Netscape).
          </p>

          <div className='mt-3 flex flex-wrap items-center gap-2'>
            <label className='simple-btn cursor-pointer'>
              {cookiesBusy ? 'Procesando…' : 'Subir cookies.txt'}
              <input
                type='file'
                accept='.txt'
                className='hidden'
                onChange={(event) => void onUploadCookies(event)}
                disabled={cookiesBusy}
              />
            </label>
            <button type='button' className='simple-btn' disabled={cookiesBusy || !cookiesConfigured} onClick={() => void onDeleteCookies()}>
              Quitar cookies
            </button>
          </div>

          <p className='mt-2 text-xs text-[#A8B1BC]'>
            Estado: {cookiesConfigured ? 'activas' : 'no configuradas'} {cookiesPath ? `• ${cookiesPath}` : ''}
          </p>
          <p className='mt-1 text-xs text-[#8F99A5]'>{cookiesMessage}</p>
        </Block>
      </div>

      <article className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
        <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>Settings cacheadas</h2>
        <pre className='mt-3 overflow-auto rounded-lg border border-[#242A30] bg-[#151B20] p-3 text-xs text-[#C6CFDA]'>
          {JSON.stringify(settings ?? [], null, 2)}
        </pre>
      </article>
    </section>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className='rounded-xl border border-[#262C33] bg-[#11161A] p-4'>
      <h2 className='text-sm font-semibold uppercase tracking-[0.08em] text-[#E6EBF3]'>{title}</h2>
      <p className='mt-2 text-sm text-[#A5AFBA]'>{children}</p>
    </article>
  );
}
