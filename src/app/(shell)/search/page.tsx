import { SearchView } from '@/features/search/search-view';

export const metadata = { title: 'Search — NEXUS' };

export default function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return searchParams.then((sp) => <SearchView initialQuery={sp.q ?? ''} />);
}
