import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { OverviewPage } from '@/features/overview/OverviewPage';
import { LabPage } from '@/features/lab/LabPage';
import { SessionPage } from '@/features/session/SessionPage';
import { ExplorePage } from '@/features/explore/ExplorePage';
import { ComparisonPage } from '@/features/comparison/ComparisonPage';
import { SystemPage } from '@/features/system/SystemPage';
import { R1Page } from '@/features/r1/R1Page';
import { MethodPage } from '@/features/method/MethodPage';
import { ArchitecturePage } from '@/features/architecture/ArchitecturePage';
import { NotFoundPage } from '@/features/system/NotFoundPage';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'lab', element: <LabPage /> },
      { path: 'lab/sessions/:sessionId', element: <SessionPage /> },
      { path: 'lab/sessions/:sessionId/explore', element: <ExplorePage /> },
      { path: 'comparisons/:jobId', element: <ComparisonPage /> },
      { path: 'r1', element: <R1Page /> },
      { path: 'architecture', element: <ArchitecturePage /> },
      { path: 'method', element: <MethodPage /> },
      { path: 'system', element: <SystemPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
export const createTestRouter = (initialEntries: string[]) => createMemoryRouter(routes, { initialEntries });
