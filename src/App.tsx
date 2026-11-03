import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Activity, Boxes, Building2, ChevronDown, ChevronRight, Factory, FileText, LayoutDashboard, LogOut, Menu, Moon, PackageSearch, Settings, ShoppingCart, Sun, UsersRound, WalletCards, X } from 'lucide-react';
import { navItems, type NavItem } from './data';
import { apiMessage, apiRequest, ApiError, setCsrfToken } from './lib/api';
import { initials } from './lib/format';
import { LoginPage, OnboardingPage } from './pages/Access';
import DashboardPage from './pages/Dashboard';
import ProductionPage from './pages/Production';
import StockPage from './pages/Stock';
import SalesPage from './pages/Sales';
import PurchasesPage from './pages/Purchases';
import WorkforcePage from './pages/Workforce';
import ExpensesPage from './pages/Expenses';
import ReportsPage from './pages/Reports';
import SettingsPage from './pages/Settings';

type Plant = { id: string; name: string; city?: string | null; currency: string };
type Workspace = { id: string; name: string; role: string; plants: Plant[]; allowedPlantIds: string[] };
type User = { id: string; name: string; email: string };
type Profile = { user: User; workspaces: Workspace[] };
type AppState = 'loading' | 'signed-out' | 'ready' | 'error';

const iconMap: Record<string, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard, factory: Factory, boxes: Boxes, sales: ShoppingCart,
  purchases: PackageSearch, workers: UsersRound, expenses: WalletCards, reports: FileText, settings: Settings,
};

export default function App() {
  const [state, setState] = useState<AppState>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [scopeVersion, setScopeVersion] = useState(0);

  const loadProfile = useCallback(async () => {
    setState('loading'); setError('');
    try {
      const session = await apiRequest<{ csrfToken?: string }>('/api/v1/auth/session');
      setCsrfToken(session.csrfToken ?? null);
      const response = await apiRequest<{ data: Profile }>('/api/v1/me');
      const nextProfile = response.data;
      setProfile(nextProfile);
      if (nextProfile.workspaces.length) {
        const storedWorkspaceId = localStorage.getItem('plantflow.workspaceId');
        const workspace = nextProfile.workspaces.find((item) => item.id === storedWorkspaceId) ?? nextProfile.workspaces[0];
        const storedPlantId = localStorage.getItem('plantflow.plantId');
        const plant = workspace.plants.find((item) => item.id === storedPlantId) ?? workspace.plants[0];
        localStorage.setItem('plantflow.workspaceId', workspace.id);
        if (plant) {
          localStorage.setItem('plantflow.plantId', plant.id);
          localStorage.setItem('plantflow.currency', plant.currency);
        } else {
          localStorage.removeItem('plantflow.plantId');
        }
      }
      setState('ready');
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        setProfile(null); setState('signed-out'); return;
      }
      setError(apiMessage(reason)); setState('error');
    }
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const currentWorkspace = useMemo(() => {
    if (!profile?.workspaces.length) return null;
    const id = localStorage.getItem('plantflow.workspaceId');
    return profile.workspaces.find((workspace) => workspace.id === id) ?? profile.workspaces[0];
  }, [profile, scopeVersion]);
  const currentPlant = useMemo(() => {
    if (!currentWorkspace?.plants.length) return null;
    const id = localStorage.getItem('plantflow.plantId');
    return currentWorkspace.plants.find((plant) => plant.id === id) ?? currentWorkspace.plants[0];
  }, [currentWorkspace, scopeVersion]);

  async function logout() {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    localStorage.removeItem('plantflow.workspaceId'); localStorage.removeItem('plantflow.plantId'); localStorage.removeItem('plantflow.currency');
    setProfile(null); setState('signed-out');
  }

  if (state === 'loading') return <main className="access-screen"><div className="panel empty-state">Chargement de votre session PlantFlow…</div></main>;
  if (state === 'signed-out') return <LoginPage />;
  if (state === 'error') return <main className="access-screen"><section className="access-card"><div className="brand-lockup access-brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>plant<span>flow</span></strong><small>OPERATIONS OS</small></div></div><h1>Impossible de charger les données.</h1><p>Vérifiez que PostgreSQL est joignable et que le serveur API est prêt.</p><div className="notice error">{error}</div><button className="primary-button access-submit" onClick={() => void loadProfile()}>Réessayer</button></section></main>;
  if (profile && profile.workspaces.length === 0) return <OnboardingPage onCreated={() => void loadProfile()} />;
  if (profile && !currentWorkspace?.plants.length) return <main className="access-screen"><section className="access-card"><h1>Aucune usine accessible.</h1><p>Demandez à un OWNER ou MANAGER de vous affecter à une usine, puis rechargez votre session.</p><button className="primary-button access-submit" onClick={() => void loadProfile()}>Actualiser mes accès</button></section></main>;

  const chooseWorkspace = (id: string) => {
    const workspace = profile?.workspaces.find((item) => item.id === id);
    if (!workspace) return;
    localStorage.setItem('plantflow.workspaceId', workspace.id);
    const plant = workspace.plants[0];
    if (plant) { localStorage.setItem('plantflow.plantId', plant.id); localStorage.setItem('plantflow.currency', plant.currency); }
    setScopeVersion((value) => value + 1);
  };
  const choosePlant = (id: string) => {
    const plant = currentWorkspace?.plants.find((item) => item.id === id);
    if (!plant) return;
    localStorage.setItem('plantflow.plantId', plant.id); localStorage.setItem('plantflow.currency', plant.currency);
    setScopeVersion((value) => value + 1);
  };

  const currentRole = currentWorkspace?.role ?? 'STAFF';
  const canViewFinance = currentRole !== 'STAFF';
  const canManageSettings = currentRole === 'OWNER' || currentRole === 'MANAGER';
  return <BrowserRouter><AppShell key={`${currentWorkspace?.id}:${currentPlant?.id}:${scopeVersion}`} user={profile?.user} workspaces={profile?.workspaces ?? []} workspace={currentWorkspace} plant={currentPlant} onWorkspace={chooseWorkspace} onPlant={choosePlant} onLogout={logout}>
    <Routes>
      <Route path="/" element={canViewFinance ? <DashboardPage /> : <Navigate to="/production" replace />} />
      <Route path="/production" element={<ProductionPage canCreate={currentRole !== 'CASHIER'} canRecordCosts={currentRole !== 'STAFF'} />} />
      <Route path="/stock" element={<StockPage />} />
      <Route path="/ventes" element={canViewFinance ? <SalesPage /> : <RestrictedModule />} />
      <Route path="/achats" element={canViewFinance ? <PurchasesPage /> : <RestrictedModule />} />
      <Route path="/main-doeuvre" element={canViewFinance ? <WorkforcePage /> : <RestrictedModule />} />
      <Route path="/depenses" element={canViewFinance ? <ExpensesPage /> : <RestrictedModule />} />
      <Route path="/rapports" element={canViewFinance ? <ReportsPage /> : <RestrictedModule />} />
      <Route path="/parametres" element={canManageSettings ? <SettingsPage /> : <RestrictedModule />} />
      <Route path="*" element={<section className="panel empty-state"><strong>Page introuvable</strong><NavLink to="/">Retour au tableau de bord</NavLink></section>} />
    </Routes>
  </AppShell></BrowserRouter>;
}

function RestrictedModule() {
  return <section className="panel empty-state"><strong>Accès réservé</strong><p>Votre rôle ne permet pas de consulter ce module ou ces données financières.</p><NavLink to="/production">Retour aux opérations</NavLink></section>;
}

function AppShell({ user, workspaces, workspace, plant, onWorkspace, onPlant, onLogout, children }: { user?: User; workspaces: Workspace[]; workspace: Workspace | null; plant: Plant | null; onWorkspace: (id: string) => void; onPlant: (id: string) => void; onLogout: () => void; children: ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('plantflow.theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('plantflow.theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((curr) => (curr === 'dark' ? 'light' : 'dark'));
  };

  const location = useLocation();
  const visibleNavItems = workspace?.role === 'STAFF' ? navItems.filter((item) => ['/production', '/stock'].includes(item.to)) : workspace?.role === 'CASHIER' ? navItems.filter((item) => item.to !== '/parametres') : navItems;
  const current = navItems.find((item) => item.to === location.pathname) ?? visibleNavItems[0] ?? navItems[0];
  let previousSection = '';
  return <div className={`app-shell theme-${theme}`}>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand-lockup"><div className="brand-mark"><span /><span /><span /></div><div><strong>plant<span>flow</span></strong><small>OPERATIONS OS</small></div><button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Fermer le menu"><X size={18} /></button></div>
      <label className="plant-switcher"><div className="plant-icon"><Building2 size={17} /></div><div><span>Usine active</span><select aria-label="Usine active" value={plant?.id ?? ''} onChange={(event) => onPlant(event.target.value)}>{workspace?.plants.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city ? ` · ${item.city}` : ''}</option>)}</select></div><ChevronDown size={15} className="muted-icon" /></label>
      <nav className="main-nav">{visibleNavItems.map((item: NavItem) => { const showSection = item.section && item.section !== previousSection; previousSection = item.section ?? previousSection; const Icon = iconMap[item.icon] ?? Activity; return <div key={item.to}>{showSection && <div className="nav-section-label">{item.section}</div>}<NavLink to={item.to} onClick={() => setMobileNav(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end={item.to === '/'}><Icon size={18} strokeWidth={1.9} /><span>{item.label}</span></NavLink></div>; })}</nav>
      <div className="sidebar-footer">
        <div className="workspace-switch"><span>Workspace</span><select aria-label="Workspace" value={workspace?.id ?? ''} onChange={(event) => onWorkspace(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="sidebar-meta"><span><span className="status-live" /> Opérations vérifiées</span><button className="sidebar-logout" onClick={onLogout}><LogOut size={13} /> Déconnexion</button></div>
      </div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="Fermer le menu" />}
    <main className="main-canvas">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Ouvrir le menu"><Menu size={20} /></button>
        <div className="breadcrumb"><span>PlantFlow</span><ChevronRight size={15} /><strong>{current.label}</strong></div>
        <div className="topbar-actions">
          {/* Bouton Toggle Thème Sombre / Clair */}
          <button 
            type="button" 
            className="theme-toggle-btn" 
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            aria-label="Changer de thème"
          >
            {theme === 'dark' ? <Sun size={17} className="sun-icon" /> : <Moon size={17} className="moon-icon" />}
            <span className="theme-toggle-label">{theme === 'dark' ? 'Mode Clair' : 'Mode Sombre'}</span>
          </button>

          <select className="topbar-workspace" aria-label="Changer de workspace" value={workspace?.id ?? ''} onChange={(event) => onWorkspace(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <div className="avatar">{initials(user?.name)}</div>
          <div className="profile-copy"><strong>{user?.name ?? 'Utilisateur'}</strong><span>{workspace?.role ?? 'Membre'} · {plant?.name ?? ''}</span></div>
          <button className="icon-button logout-button" onClick={onLogout} aria-label="Déconnexion"><LogOut size={17} /></button>
        </div>
      </header>
      <div className="page-content">{children}</div>
    </main>
  </div>;
}
