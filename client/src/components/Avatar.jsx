import { initials } from '../util';

export default function Avatar({ user, size = 26 }) {
  if (!user) return null;
  const style = { width: size, height: size, fontSize: size * 0.4 };
  return user.avatar_url ? (
    <img className="avatar" src={user.avatar_url} alt={user.name} title={user.name} style={style} referrerPolicy="no-referrer" />
  ) : (
    <span className="avatar avatar-fallback" title={user.name} style={style}>{initials(user.name)}</span>
  );
}
