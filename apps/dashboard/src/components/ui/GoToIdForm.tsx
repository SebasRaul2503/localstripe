import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Search } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Field';

/** Small "jump to object" form: navigates to `${basePath}/<id>`. */
export function GoToIdForm({
  basePath,
  placeholder,
  label,
}: {
  basePath: string;
  placeholder: string;
  label: string;
}) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const id = value.trim();
        if (id) void navigate(`${basePath}/${encodeURIComponent(id)}`);
      }}
    >
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="w-full font-mono text-xs sm:w-64"
      />
      <Button type="submit" icon={<Search className="size-4" aria-hidden />}>
        Go
      </Button>
    </form>
  );
}
