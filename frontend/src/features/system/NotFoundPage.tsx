import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="surface max-w-xl p-6">
      <h1 className="text-2xl">Page not found</h1>
      <p className="mt-2 text-muted">This route does not exist in the application.</p>
      <Link to="/" className="mt-4 inline-block text-teal underline">
        Back to the overview
      </Link>
    </div>
  );
}
