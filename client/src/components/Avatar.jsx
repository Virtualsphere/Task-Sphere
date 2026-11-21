import { initials } from '../util';

// `online` puts a green glow around the picture
export default function Avatar({ user, size = 26, online = false }) {
  if (!user) return null;
  const style = { width: size, height: size, fontSize: size * 0.4 };
  const cls = `avatar ${online ? 'is-online' : ''}`;
  const title = online ? `${user.name} · Online` : user.name;
  return user.avatar_url ? (
    <img className={cls} src={user.avatar_url} alt={user.name} title={title} style={style} referrerPolicy="no-referrer" />
  ) : (
    <span className={`${cls} avatar-fallback`} title={title} style={style}>{initials(user.name)}</span>
  );
}
