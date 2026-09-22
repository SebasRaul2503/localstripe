import { useState } from 'react';
import { Link, Outlet } from 'react-router';
import { BookOpen, FlaskConical, Menu, X } from 'lucide-react';
import { useAppConfig } from '../../hooks/useAppConfig';
import { NavLinks } from './NavLinks';
import { ThemeToggle } from './ThemeToggle';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-md bg-indigo-600 text-sm text-white">
        LS
      </span>
      <span>LocalStripe</span>
    </Link>
  );
}

function TestModeBanner() {
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>Test mode — LocalStripe is a mock. No real payments are processed.</span>
    </div>
  );
}

export function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { docsUrl } = useAppConfig();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="sticky top-0 z-30">
        <TestModeBanner />
        <header className="flex h-14 items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
          <button
            type="button"
            className="rounded-md p-1.5 text-zinc-700 hover:bg-zinc-100 lg:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X className="size-5" aria-hidden />
            ) : (
              <Menu className="size-5" aria-hidden />
            )}
          </button>
          <Logo />
          <span className="hidden rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900 uppercase sm:inline dark:bg-amber-950 dark:text-amber-300">
            Test data
          </span>
          <div className="ml-auto flex items-center gap-2">
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <BookOpen className="size-4" aria-hidden />
              <span className="hidden sm:inline">API docs</span>
              <span className="sr-only sm:hidden">API docs</span>
            </a>
            <ThemeToggle />
          </div>
        </header>
        {menuOpen ? (
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="max-h-[calc(100vh-6rem)] overflow-y-auto border-b border-zinc-200 bg-white p-4 shadow-lg lg:hidden dark:border-zinc-800 dark:bg-zinc-900"
          >
            <NavLinks onNavigate={() => setMenuOpen(false)} />
          </nav>
        ) : null}
      </div>
      <div className="flex flex-1">
        <nav
          aria-label="Main"
          className="sticky top-[5.75rem] hidden h-[calc(100vh-5.75rem)] w-60 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white px-3 py-5 lg:block dark:border-zinc-800 dark:bg-zinc-900"
        >
          <NavLinks />
        </nav>
        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
