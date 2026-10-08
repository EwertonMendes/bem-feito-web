import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { publicOnlyGuard } from './core/auth/public-only.guard';
import { AppShell } from './layout/app-shell/app-shell';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [publicOnlyGuard],
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'acesso-negado',
    loadComponent: () => import('./pages/access-denied/access-denied.page').then((m) => m.AccessDeniedPage),
  },
  {
    path: '',
    component: AppShell,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: 'Dashboard | Bem Feito', loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'vendas', title: 'Vendas | Bem Feito', loadComponent: () => import('./pages/sales/sales.page').then((m) => m.SalesPage) },
      { path: 'producao', title: 'Produção | Bem Feito', loadComponent: () => import('./pages/production/production.page').then((m) => m.ProductionPage) },
      { path: 'estoque', title: 'Estoque | Bem Feito', loadComponent: () => import('./pages/inventory/inventory.page').then((m) => m.InventoryPage) },
      { path: 'financeiro', title: 'Financeiro | Bem Feito', loadComponent: () => import('./pages/finance/finance.page').then((m) => m.FinancePage) },
      { path: 'catalogo', title: 'Catálogo | Bem Feito', loadComponent: () => import('./pages/catalog/catalog.page').then((m) => m.CatalogPage) },
      { path: 'configuracoes', title: 'Configurações | Bem Feito', loadComponent: () => import('./pages/settings/settings.page').then((m) => m.SettingsPage) },
    ],
  },
  {
    path: '**',
    loadComponent: () => import('./pages/not-found/not-found.page').then((m) => m.NotFoundPage),
  },
];
