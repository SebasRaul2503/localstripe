import { ButtonLink } from '../components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        The page you are looking for does not exist in the LocalStripe dashboard.
      </p>
      <ButtonLink variant="primary" to="/" className="mt-6">
        Back to overview
      </ButtonLink>
    </div>
  );
}
