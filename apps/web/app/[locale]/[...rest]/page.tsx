import { notFound } from 'next/navigation';

// Catch-all so unknown localized paths render app/[locale]/not-found.tsx.
export default function CatchAll() {
  notFound();
}
