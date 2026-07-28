import { Navigate } from 'react-router-dom';

/** @deprecated Use /settings/account — kept as redirect for sidebar/bookmarks. */
const Profile = () => <Navigate to="/settings/account" replace />;

export default Profile;
