export type NavItem = {
  label: string;
  to: string;
  icon: string;
  section?: string;
};

export const navItems: NavItem[] = [
  { label: 'Vue d’ensemble', to: '/', icon: 'dashboard' },
  { label: 'Production', to: '/production', icon: 'factory', section: 'Opérations' },
  { label: 'Stock & matières', to: '/stock', icon: 'boxes' },
  { label: 'Ventes & clients', to: '/ventes', icon: 'sales' },
  { label: 'Achats & fournisseurs', to: '/achats', icon: 'purchases' },
  { label: 'Main-d’œuvre', to: '/main-doeuvre', icon: 'workers', section: 'Ressources' },
  { label: 'Dépenses', to: '/depenses', icon: 'expenses' },
  { label: 'Rapports', to: '/rapports', icon: 'reports', section: 'Pilotage' },
  { label: 'Paramètres', to: '/parametres', icon: 'settings' },
];
