import { Navigate } from 'react-router-dom';

/** @deprecated 메뉴 통합 — /safety-cost?tab=validation 으로 리다이렉트 */
export default function SafetyCostValidation() {
  return <Navigate to="/app/admin/safety-cost?tab=validation" replace />;
}
