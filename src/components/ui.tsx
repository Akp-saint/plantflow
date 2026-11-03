import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, LoaderCircle, Plus, X } from 'lucide-react';
import { apiMessage, apiRequest } from '../lib/api';

export function useApiQuery<T>(path: string) {
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    apiRequest<T>(path)
      .then((result) => { if (active) setData(result); })
      .catch((reason: unknown) => { if (active) setError(apiMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, version]);
  return { data, loading, error, reload: () => setVersion((current) => current + 1) };
}

export function PageHeader({ title, description, eyebrow, action, actionLabel }: { title: string; description: string; eyebrow: string; action?: () => void; actionLabel?: string }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && actionLabel && <button type="button" className="primary-button" onClick={action}><Plus size={16} /> {actionLabel}</button>}</div>;
}

export function Modal({ title, description, onClose, children, wide = false }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">Saisie opérationnelle</div><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fermer"><X size={18} /></button></div>{description && <p className="modal-description">{description}</p>}{children}</section></div>;
}

export function FormActions({ onCancel, saving, label = 'Enregistrer' }: { onCancel: () => void; saving?: boolean; label?: string }) {
  return <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Annuler</button><button type="submit" className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? 'Enregistrement…' : label}</button></div>;
}

export function Notice({ error, success }: { error?: string; success?: string }) {
  if (error) return <div className="notice error" role="alert">{error}</div>;
  if (success) return <div className="notice success" role="status"><Check size={16} />{success}</div>;
  return null;
}

export function LoadingOrEmpty({ loading, error, empty, children }: { loading: boolean; error?: string; empty?: boolean; children?: ReactNode }) {
  if (loading) return <div className="panel empty-state"><LoaderCircle className="spin" size={20} />Chargement des données…</div>;
  if (error) return <Notice error={error} />;
  if (empty) return <div className="panel empty-state"><strong>Aucune donnée pour le moment</strong><span>Les enregistrements créés apparaîtront ici.</span></div>;
  return <>{children}</>;
}

export function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'neutral' }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function InlineForm({ onSubmit, children, onCancel, saving = false, submitLabel = 'Enregistrer' }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; children: ReactNode; onCancel: () => void; saving?: boolean; submitLabel?: string }) {
  return <form onSubmit={onSubmit}>{children}<FormActions onCancel={onCancel} saving={saving} label={submitLabel} /></form>;
}
