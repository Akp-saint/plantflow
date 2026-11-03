import { useState, type FormEvent } from 'react';
import { Factory, ShieldCheck, ArrowRight, ArrowLeft, ChevronRight, Globe, Lock, Mail, User as UserIcon } from 'lucide-react';
import { apiMessage, apiRequest } from '../lib/api';
import { Notice } from '../components/ui';

export function LoginPage() {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await apiRequest<{ csrfToken?: string }>(
        register ? '/api/v1/auth/register' : '/api/v1/auth/login',
        { method: 'POST', body: JSON.stringify(body) }
      );
      window.location.reload();
      void response;
    } catch (reason) {
      setError(apiMessage(reason));
      setBusy(false);
    }
  }

  return (
    <main className="modern-auth-viewport">
      {/* Background split decorative ambiance */}
      <div className="modern-auth-ambient-bg" />

      {/* Main floating container */}
      <div className="modern-auth-card">
        {/* Left Side: Cinematic Industrial Image Card */}
        <div className="modern-auth-banner">
          <img
            src="/plant-banner.jpg"
            alt="PlantFlow Usine de Briques"
            className="modern-auth-banner-img"
          />
          <div className="modern-auth-banner-overlay" />

          {/* Top Bar inside image */}
          <div className="banner-top-bar">
            <div className="banner-badge">Opérations Briqueterie</div>
            <div className="banner-actions">
              <button
                type="button"
                className={`banner-tab ${!register ? 'active' : ''}`}
                onClick={() => { setRegister(false); setError(''); }}
              >
                Connexion
              </button>
              <button
                type="button"
                className={`banner-tab-pill ${register ? 'active' : ''}`}
                onClick={() => { setRegister(true); setError(''); }}
              >
                Créer un compte
              </button>
            </div>
          </div>

          {/* Bottom Card inside image */}
          <div className="banner-bottom-info">
            <div className="banner-author">
              <div className="banner-avatar">
                <Factory size={18} />
              </div>
              <div className="banner-author-text">
                <strong>PlantFlow ERP</strong>
                <span>Pilotage & Gestion d'Usine</span>
              </div>
            </div>
            <div className="banner-nav-arrows">
              <span className="banner-tag">Burkina Faso • XOF</span>
            </div>
          </div>
        </div>

        {/* Right Side: Clean Form */}
        <div className="modern-auth-form-wrap">
          {/* Top Header */}
          <div className="form-top-header">
            <div className="brand-lockup-minimal">
              <strong>PLANT<span>FLOW</span></strong>
            </div>
            <div className="lang-pill">
              <Globe size={13} />
              <span>FR (XOF)</span>
            </div>
          </div>

          {/* Form Content */}
          <div className="form-main-body">
            <div className="form-heading">
              <h1>{register ? 'Créer un accès' : 'Bonjour'}</h1>
              <p>
                {register
                  ? 'Configurez votre accès administrateur à l’usine.'
                  : 'Bienvenue sur votre espace de gestion d’usine.'}
              </p>
            </div>

            <Notice error={error} />

            <form onSubmit={submit} className="modern-form">
              {register && (
                <div className="input-group-modern">
                  <span className="input-icon"><UserIcon size={16} /></span>
                  <input
                    name="name"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="Nom complet ou raison sociale"
                  />
                </div>
              )}

              <div className="input-group-modern">
                <span className="input-icon"><Mail size={16} /></span>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="Adresse email professionnelle"
                />
              </div>

              <div className="input-group-modern">
                <span className="input-icon"><Lock size={16} /></span>
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder="Mot de passe (8 caractères minimum)"
                />
              </div>

              {!register && (
                <div className="form-sub-row">
                  <span className="quick-fill-hint">Démo: <em>admin@plantflow.com</em></span>
                  <button
                    type="button"
                    className="forgot-link"
                    onClick={() => alert("Pour réinitialiser votre mot de passe, contactez l'administrateur du système ou l'équipe technique.")}
                  >
                    Mot de passe oublié ?
                  </button>
                </div>
              )}

              <button className="modern-submit-btn" disabled={busy}>
                <span>{busy ? (register ? 'Création en cours…' : 'Connexion…') : (register ? 'Créer mon compte' : 'Se connecter')}</span>
                <ArrowRight size={16} />
              </button>
            </form>

            <div className="divider-modern">
              <span>ou</span>
            </div>

            <button
              type="button"
              className="quick-switch-btn"
              onClick={() => { setRegister(!register); setError(''); }}
            >
              {register ? (
                <>Vous avez déjà un compte ? <strong>Se connecter</strong></>
              ) : (
                <>Pas encore de compte ? <strong>Créer un compte</strong></>
              )}
            </button>
          </div>

          {/* Footer note */}
          <div className="form-bottom-footer">
            <ShieldCheck size={14} />
            <span>Sécurisé par session chiffrée, hachage Scrypt & CSRF</span>
          </div>
        </div>
      </div>
    </main>
  );
}

export function OnboardingPage({ onCreated }: { onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest('/api/v1/workspaces', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries()))
      });
      onCreated();
    } catch (reason) {
      setError(apiMessage(reason));
      setSaving(false);
    }
  }

  return (
    <main className="access-screen">
      <section className="access-card onboarding-card">
        <div className="eyebrow"><Factory size={14} /> Configuration initiale</div>
        <h1>Créons votre espace de travail.</h1>
        <p>Ce workspace et cette première usine seront rattachés à votre compte.</p>
        <Notice error={error} />
        <form onSubmit={createWorkspace}>
          <div className="form-grid">
            <label>Nom du workspace<input name="name" required minLength={2} maxLength={120} placeholder="Ex. Briques du Centre" /></label>
            <label>Nom de l’usine<input name="plantName" required minLength={2} maxLength={120} placeholder="Ex. Usine principale" /></label>
            <label>Ville<input name="city" maxLength={120} placeholder="Ville, région" /></label>
            <label>Devise<select name="currency" defaultValue="XOF"><option value="XOF">XOF — Franc CFA BCEAO</option></select></label>
            <label>Format initial<input name="brickSizeName" required defaultValue="Brique standard" maxLength={80} /></label>
            <label>Dimensions<input name="brickDimensions" required defaultValue="230 × 110 × 75 mm" maxLength={80} /></label>
          </div>
          <label>Adresse de l’usine<textarea name="address" rows={2} maxLength={300} placeholder="Facultatif" /></label>
          <div className="onboarding-help">Le format initial est créé avec le nom et les dimensions choisis. Aucun stock ni montant fictif n’est créé.</div>
          <div className="modal-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Création…' : 'Créer le workspace'}</button></div>
        </form>
      </section>
    </main>
  );
}
