import { Navigate } from "react-router-dom";

/** @deprecated Use /consent (ConsentPage). */
export default function WorkerConsentPage() {
  return <Navigate to="/consent" replace />;
}
