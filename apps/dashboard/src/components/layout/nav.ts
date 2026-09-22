import {
  CreditCard,
  Home,
  KeyRound,
  ListChecks,
  RotateCcw,
  Settings,
  ShoppingCart,
  Users,
  Wallet,
  Webhook,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Payments',
    items: [
      { to: '/', label: 'Overview', icon: Home },
      { to: '/payments', label: 'Payments', icon: Wallet },
      { to: '/refunds', label: 'Refunds', icon: RotateCcw },
      { to: '/checkout-sessions', label: 'Checkout sessions', icon: ShoppingCart },
      { to: '/customers', label: 'Customers', icon: Users },
      { to: '/payment-methods', label: 'Payment methods', icon: CreditCard },
    ],
  },
  {
    title: 'Developers',
    items: [
      { to: '/events', label: 'Events', icon: Zap },
      { to: '/webhooks', label: 'Webhooks', icon: Webhook },
      { to: '/api-keys', label: 'API keys', icon: KeyRound },
      { to: '/test-cards', label: 'Test cards', icon: ListChecks },
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];
