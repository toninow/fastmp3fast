type SyncUiStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'sync_error' | 'unknown';

function normalizeSyncStatus(value: string | null | undefined): SyncUiStatus {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'idle') {
    return 'idle';
  }
  if (raw === 'syncing') {
    return 'syncing';
  }
  if (raw === 'synced') {
    return 'synced';
  }
  if (raw === 'offline') {
    return 'offline';
  }
  if (raw === 'sync_error') {
    return 'sync_error';
  }
  return 'unknown';
}

export function getSyncStatusText(value: string | null | undefined, options?: { compact?: boolean }): string {
  const status = normalizeSyncStatus(value);
  const compact = Boolean(options?.compact);

  if (compact) {
    if (status === 'idle' || status === 'synced') {
      return 'Al día';
    }
    if (status === 'syncing') {
      return 'Sincronizando';
    }
    if (status === 'offline') {
      return 'Offline';
    }
    if (status === 'sync_error') {
      return 'Con errores';
    }
    return 'Pendiente';
  }

  if (status === 'idle' || status === 'synced') {
    return 'Sincronización al día';
  }
  if (status === 'syncing') {
    return 'Sincronizando cambios...';
  }
  if (status === 'offline') {
    return 'Sin conexión (guardando en local)';
  }
  if (status === 'sync_error') {
    return 'Error de sincronización';
  }
  return 'Sincronización pendiente';
}

export function getSyncStatusClass(value: string | null | undefined): string {
  const status = normalizeSyncStatus(value);
  if (status === 'sync_error') {
    return 'text-[#FFB7BD]';
  }
  if (status === 'offline') {
    return 'text-[#F7E733]';
  }
  if (status === 'syncing') {
    return 'text-[#67E8F9]';
  }
  return 'text-[#A3FF12]';
}

export function getOperationStatusText(value: string | null | undefined): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'pending') {
    return 'Pendiente';
  }
  if (raw === 'synced') {
    return 'Sincronizada';
  }
  if (raw === 'error') {
    return 'Error';
  }
  if (raw === 'conflict') {
    return 'Conflicto';
  }
  return 'Desconocido';
}
