import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.error("404 Error:", location.pathname);
    }
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center space-y-3">
        <h1 className="mb-2 text-4xl font-bold">404</h1>
        <p className="text-xl text-muted-foreground">페이지를 찾을 수 없습니다</p>
        <p className="text-sm text-muted-foreground">{location.pathname}</p>
        <a href="/" className="inline-block text-primary underline hover:text-primary/90">
          첫 화면으로 이동
        </a>
      </div>
    </div>
  );
};

export default NotFound;
