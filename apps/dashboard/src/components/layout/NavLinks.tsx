import { NavLink } from 'react-router';
import clsx from 'clsx';
import { NAV_SECTIONS } from './nav';

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="space-y-6">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="px-2.5 pb-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm',
                      isActive
                        ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                        : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white',
                    )
                  }
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
