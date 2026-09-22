import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from './Field';

/** Text filter applied on submit (Enter), so the URL and API are not hit on every keystroke. */
export function SearchInput({
  value,
  onSearch,
  label,
  placeholder,
}: {
  value: string;
  onSearch: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      role="search"
      className="relative"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400"
        aria-hidden
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (event.target.value === '' && value !== '') onSearch('');
        }}
        className="w-full pl-8 sm:w-72"
      />
    </form>
  );
}
