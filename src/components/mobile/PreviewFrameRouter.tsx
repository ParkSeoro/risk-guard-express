/**
 * In-memory location/navigator for PC mobile preview.
 * Overrides React Router contexts without nesting a <Router>
 * (MemoryRouter inside BrowserRouter throws).
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  UNSAFE_LocationContext as LocationContext,
  UNSAFE_NavigationContext as NavigationContext,
  UNSAFE_RouteContext as RouteContext,
  createPath,
  resolvePath,
  type Location,
  type Navigator,
  type To,
} from "react-router-dom";

function toLocation(to: To, currentPathname: string, state: unknown, key: string): Location {
  const resolved = resolvePath(to, currentPathname);
  return {
    pathname: resolved.pathname,
    search: resolved.search,
    hash: resolved.hash,
    state: state ?? null,
    key,
  };
}

const EMPTY_ROUTE_CTX = {
  outlet: null,
  matches: [] as const,
  isDataRoute: false,
};

export default function PreviewFrameRouter({
  initialPath = "/app/worker/today",
  children,
}: {
  initialPath?: string;
  children: ReactNode;
}) {
  const [location, setLocation] = useState<Location>(() =>
    toLocation(initialPath, "/", null, "preview"),
  );

  const navigator = useMemo<Navigator>(
    () => ({
      createHref: (to) => createPath(resolvePath(to as To, location.pathname)),
      encodeLocation: (to) => {
        const path = resolvePath(to as To, location.pathname);
        return {
          pathname: path.pathname,
          search: path.search,
          hash: path.hash,
        };
      },
      go: () => {},
      push: (to, state) => {
        setLocation((cur) => toLocation(to, cur.pathname, state, `preview-${Date.now()}`));
      },
      replace: (to, state) => {
        setLocation((cur) => toLocation(to, cur.pathname, state, `preview-${Date.now()}`));
      },
    }),
    [location.pathname],
  );

  const navCtx = useMemo(
    () => ({
      basename: "",
      navigator,
      static: false as const,
      future: { v7_relativeSplatPath: true },
    }),
    [navigator],
  );

  const locCtx = useMemo(
    () => ({ location, navigationType: "POP" as const }),
    [location],
  );

  return (
    <NavigationContext.Provider value={navCtx}>
      <LocationContext.Provider value={locCtx}>
        <RouteContext.Provider value={EMPTY_ROUTE_CTX as any}>{children}</RouteContext.Provider>
      </LocationContext.Provider>
    </NavigationContext.Provider>
  );
}
